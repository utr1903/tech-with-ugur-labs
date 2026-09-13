import { Writable } from "node:stream";
import pino from "pino";
import { expect, it } from "vitest";
import { ExecutionError } from "../execution/types.js";
import { operation } from "./operation.js";

it("logs summaries and safe failures without backend data or command bytes", async () => {
  let lines = "";
  const logger = pino(
    { serializers: { err: pino.stdSerializers.errWithCause } },
    new Writable({
      write(chunk, _encoding, done) {
        lines += chunk.toString();
        done();
      },
    }),
  );
  expect(
    await operation(
      logger,
      "Read results",
      { id: "generated" },
      async () => 3,
      (count) => ({ count }),
    ),
  ).toBe(3);
  await expect(
    operation(logger, "Create Job", {}, async () => {
      throw new Error("synthetic-command-and-private-bytes");
    }),
  ).rejects.toMatchObject({ kind: "infrastructure" });
  await expect(
    operation(logger, "Wait Job", {}, async () => {
      throw new ExecutionError("timeout");
    }),
  ).rejects.toMatchObject({ kind: "timeout" });
  const records = lines
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(records.map((record) => record.msg)).toEqual([
    "Read results...",
    "Read results succeeded.",
    "Create Job...",
    "Create Job failed.",
    "Wait Job...",
    "Wait Job failed.",
  ]);
  expect(records[1]).toMatchObject({ count: 3 });
  expect(records[3].err.message).toBe("Execution failed.");
  expect(lines).not.toContain("synthetic-command-and-private-bytes");
});
it.each([
  ["ENOSPC", "write"],
  ["EPERM", "chown"],
] as const)(
  "retains %s diagnostics through nested operation boundaries",
  async (code, syscall) => {
    let lines = "";
    const logger = pino(
      { serializers: { err: pino.stdSerializers.errWithCause } },
      new Writable({
        write(chunk, _encoding, done) {
          lines += chunk.toString();
          done();
        },
      }),
    );
    const original = Object.assign(
      new Error("submitted-command-and-result-canary"),
      { code, syscall },
    );
    await expect(
      operation(logger, "Execute", {}, () =>
        operation(logger, "Store", {}, async () => {
          throw original;
        }),
      ),
    ).rejects.toMatchObject({
      kind: "infrastructure",
      cause: { category: "filesystem", code, syscall },
    });
    const records = lines
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.at(-1).err.cause).toMatchObject({
      category: "filesystem",
      code,
      syscall,
    });
    expect(lines).not.toContain("submitted-command-and-result-canary");
  },
);
