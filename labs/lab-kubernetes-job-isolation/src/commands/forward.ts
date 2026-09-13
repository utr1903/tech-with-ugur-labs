import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createConnection, createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { operation } from "../lib/operation.js";
import type { Logger } from "../logger.js";
import { args, type Forward, identity, stopOwned } from "./forward-process.js";
import { root } from "./settings.js";

export { identity, stopOwned } from "./forward-process.js";

const runtime = `${root}/.runtime`;
const state = `${runtime}/forwards.json`;

function records(): Forward[] {
  try {
    return JSON.parse(readFileSync(state, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
function save(value: Forward[]): void {
  mkdirSync(runtime, { recursive: true });
  writeFileSync(state, JSON.stringify(value), { mode: 0o600 });
}
export async function stopForwards(logger: Logger): Promise<void> {
  await operation(logger, "Stopping owned port forwards", {}, async () => {
    for (const record of records())
      await operation(
        logger,
        "Stopping port forward",
        {
          pid: record.pid,
          command: "kubectl",
          args: args(record.namespace, record.port),
        },
        () => stopOwned(record, logger),
      );
    save([]);
  });
}
async function available(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });
}
async function connected(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (ready: boolean) => {
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("connect", () => finish(true));
  });
}
async function ready(record: Forward, logger: Logger): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (identity(record.pid, logger) !== record.identity)
      throw new Error("Port forward exited before readiness.");
    const logs = readFileSync(record.log, "utf8");
    if (
      logs.includes(`Forwarding from 127.0.0.1:${record.port}`) &&
      (await connected(record.port))
    )
      return;
    await delay(100);
  }
  throw new Error("Port forward readiness timed out.");
}
async function start(
  namespace: string,
  port: number,
  logger: Logger,
): Promise<void> {
  return operation(
    logger,
    "Starting port forward",
    {
      namespace,
      port,
      command: "kubectl",
      args: args(namespace, port),
      cwd: root,
    },
    async () => {
      // Check availability before spawning and persist ownership before waiting for readiness.
      await available(port);
      mkdirSync(runtime, { recursive: true });
      const log = `${runtime}/${namespace}-${randomUUID()}.log`;
      const fd = openSync(log, "wx", 0o600);
      const child = spawn("kubectl", args(namespace, port), {
        cwd: root,
        detached: true,
        stdio: ["ignore", fd, fd],
      });
      closeSync(fd);
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
      const pid = child.pid;
      const owner = pid ? identity(pid, logger) : undefined;
      if (!pid || !owner)
        throw new Error("Unable to identify owned port forward.");
      const record = { pid, identity: owner, namespace, port, log };
      save([...records(), record]);
      await ready(record, logger);
    },
  );
}
export async function startForwards(logger: Logger): Promise<void> {
  await stopForwards(logger);
  try {
    await start("insecure", 3000, logger);
    await start("secure", 3001, logger);
  } catch (err) {
    // Roll back recorded forwards if either listener fails to become ready.
    await stopForwards(logger);
    throw err;
  }
}
