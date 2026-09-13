import { Writable } from "node:stream";
import pino from "pino";
import { expect, it } from "vitest";
import { KubernetesExecutionService } from "./service.js";
import {
  ExecutionError,
  type ExecutionStore,
  type JobClient,
} from "./types.js";

const logger = pino({ level: "silent" });
function fixture(log = logger) {
  const active = new Set<string>();
  const completed = new Set<string>();
  const events: string[] = [];
  const waiters = new Map<string, () => void>();
  let failure: "prepare" | "create" | "wait" | "read" | "delete" | undefined;
  const store: ExecutionStore = {
    prepare: async (id) => {
      events.push(`prepare:${id}`);
      if (failure === "prepare") throw new Error("prepare failed");
    },
    read: async (id) => {
      if (!completed.has(id)) throw new Error("read before completion");
      if (failure === "read") throw new Error("missing result");
      return { id, exitCode: 7, output: "hello\n" };
    },
    remove: async (id) => {
      events.push(`storage-remove:${id}`);
    },
  };
  const jobs: JobClient = {
    create: async (id, message) => {
      expect(message).toBe("true");
      active.add(id);
      events.push(`create:${id}`);
      if (active.size > 2) throw new Error("too many actual jobs");
      if (failure === "create") throw new Error("create response failed");
    },
    wait: async (id) => {
      if (failure === "wait") throw new ExecutionError("timeout");
      await new Promise<void>((resolve) =>
        waiters.set(id, () => {
          active.delete(id);
          completed.add(id);
          resolve();
        }),
      );
    },
    remove: async (id) => {
      events.push(`delete:${id}`);
      if (failure === "delete") throw new Error("delete failed");
      active.delete(id);
      waiters.delete(id);
    },
  };
  const service = new KubernetesExecutionService(store, jobs, log, {
    requestTimeoutMs: 200,
    cleanupReserveMs: 20,
  });
  return {
    service,
    active,
    events,
    waiters,
    setFailure: (value: typeof failure) => {
      failure = value;
    },
    finish: () => {
      const next = waiters.values().next().value;
      if (!next) throw new Error("No waiter");
      waiters.delete(waiters.keys().next().value ?? "");
      next();
    },
  };
}
it("correlates command, slot acquisition and execution outcome without logging result text", async () => {
  let logs = "";
  const f = fixture(
    pino(
      new Writable({
        write(chunk, _encoding, done) {
          logs += chunk;
          done();
        },
      }),
    ),
  );
  const pending = f.service.execute("true");
  await until(() => f.waiters.size === 1);
  f.finish();
  const result = await pending;
  const records = logs
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const execution = records.filter((record) =>
    record.msg.startsWith("Run execution"),
  );
  expect(execution.map((record) => record.level)).toEqual([30, 30]);
  expect(
    execution.every(
      (record) => record.id === result.id && record.command === "/bin/sh",
    ),
  ).toBe(true);
  expect(execution[0].args).toEqual(["-c", "true"]);
  expect(execution[1].exitCode).toBe(7);
  expect(
    records.filter((record) => record.msg.startsWith("Acquire execution slot")),
  ).toHaveLength(2);
  expect(records.every((record) => record.output === undefined)).toBe(true);
});
it("logs failed execution with the generated id and submitted command before recovery", async () => {
  let logs = "";
  const f = fixture(
    pino(
      new Writable({
        write(chunk, _encoding, done) {
          logs += chunk;
          done();
        },
      }),
    ),
  );
  f.setFailure("wait");
  await expect(f.service.execute("true")).rejects.toMatchObject({
    kind: "timeout",
  });
  const records = logs
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const failed = records.find(
    (record) => record.msg === "Run execution failed.",
  );
  expect(failed).toMatchObject({
    level: 50,
    command: "/bin/sh",
    args: ["-c", "true"],
    id: expect.any(String),
  });
  expect(f.active.size).toBe(0);
});
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
it("prepares storage before submission, collects nonzero exit and limits real active Jobs to two", async () => {
  const f = fixture();
  const first = f.service.execute("true");
  const second = f.service.execute("true");
  const third = f.service.execute("true");
  await until(() => f.waiters.size === 2);
  expect(f.active.size).toBe(2);
  expect(f.events.filter((event) => event.startsWith("create:"))).toHaveLength(
    2,
  );
  f.finish();
  expect(await first).toMatchObject({ exitCode: 7, output: "hello\n" });
  await until(() => f.waiters.size === 2);
  expect(f.active.size).toBe(2);
  f.finish();
  f.finish();
  await Promise.all([second, third]);
  expect(f.events[0]?.startsWith("prepare:")).toBe(true);
  expect(f.events.filter((event) => event.startsWith("delete:"))).toEqual([]);
});
it.each(["prepare", "create", "wait", "read"] as const)(
  "releases capacity after %s failure and recovers",
  async (failure) => {
    const f = fixture();
    f.setFailure(failure);
    const request = f.service.execute("true");
    if (failure === "read") {
      await until(() => f.waiters.size === 1);
      f.finish();
    }
    await expect(request).rejects.toMatchObject({
      kind: failure === "wait" ? "timeout" : "infrastructure",
    });
    expect(f.active.size).toBe(0);
    f.setFailure(undefined);
    const recovered = f.service.execute("true");
    await until(() => f.waiters.size === 1);
    f.finish();
    expect(await recovered).toMatchObject({ exitCode: 7 });
  },
);
it("awaits Job deletion before returning timeout", async () => {
  const f = fixture();
  f.setFailure("wait");
  await expect(f.service.execute("true")).rejects.toMatchObject({
    kind: "timeout",
  });
  expect(
    f.events.findIndex((event) => event.startsWith("delete:")),
  ).toBeLessThan(
    f.events.findIndex((event) => event.startsWith("storage-remove:")),
  );
  expect(f.active.size).toBe(0);
});
it("includes queue and scheduling in its absolute deadline and recovers after timeout", async () => {
  const f = fixture();
  const first = f.service.execute("true").catch((err) => err);
  const second = f.service.execute("true").catch((err) => err);
  await until(() => f.active.size === 2);
  const third = f.service.execute("true").catch((err) => err);
  expect(await third).toMatchObject({ kind: "timeout" });
  expect(await first).toMatchObject({ kind: "timeout" });
  expect(await second).toMatchObject({ kind: "timeout" });
  expect(f.active.size).toBe(0);
});
it("quarantines an uncertain create when deletion fails and retries cleanup before new submission", async () => {
  const f = fixture();
  f.setFailure("create");
  await expect(f.service.execute("true")).rejects.toMatchObject({
    kind: "infrastructure",
  });
  expect(f.active.size).toBe(0);
  f.setFailure("delete");
  const failed = f.service.execute("true").catch((err) => err);
  await until(() => f.active.size === 1);
  expect(await failed).toMatchObject({ kind: "infrastructure" });
  const count = f.events.filter((event) => event.startsWith("create:")).length;
  await expect(f.service.execute("true")).rejects.toMatchObject({
    kind: "infrastructure",
  });
  expect(f.events.filter((event) => event.startsWith("create:"))).toHaveLength(
    count,
  );
  f.setFailure(undefined);
  const recovered = f.service.execute("true");
  await until(
    () =>
      f.events.filter((event) => event.startsWith("create:")).length > count &&
      f.waiters.size === 1,
  );
  f.finish();
  expect(await recovered).toMatchObject({ exitCode: 7 });
  expect(f.active.size).toBe(0);
});
