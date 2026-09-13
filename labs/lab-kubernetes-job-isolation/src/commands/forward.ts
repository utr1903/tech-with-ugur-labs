import { spawn, spawnSync } from "node:child_process";
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
import { context, root } from "./settings.js";

type Forward = {
  pid: number;
  identity: string;
  namespace: string;
  port: number;
  log: string;
};
const runtime = `${root}/.runtime`;
const state = `${runtime}/forwards.json`;
function args(namespace: string, port: number): string[] {
  return [
    "--context",
    context,
    "-n",
    namespace,
    "port-forward",
    "service/server",
    `${port}:3000`,
    "--address",
    "127.0.0.1",
  ];
}
export function identity(pid: number): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  const result = spawnSync(
    "ps",
    ["-p", String(pid), "-o", "lstart=", "-o", "command="],
    { encoding: "utf8" },
  );
  return result.status === 0 ? result.stdout.trim() : undefined;
}
export async function stopOwned(record: Forward): Promise<void> {
  const current = identity(record.pid);
  const suffix = `kubectl ${args(record.namespace, record.port).join(" ")}`;
  if (!current || current !== record.identity || !current.endsWith(suffix))
    return;
  process.kill(record.pid, "SIGTERM");
  for (
    let attempt = 0;
    attempt < 100 && identity(record.pid) === current;
    attempt++
  )
    await delay(50);
  if (identity(record.pid) === current)
    throw new Error("Owned port forward did not stop.");
}
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
export async function stopForwards(): Promise<void> {
  for (const record of records()) await stopOwned(record);
  save([]);
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
async function ready(record: Forward): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (identity(record.pid) !== record.identity)
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
async function start(namespace: string, port: number): Promise<void> {
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
  const owner = pid ? identity(pid) : undefined;
  if (!pid || !owner) throw new Error("Unable to identify owned port forward.");
  const record = { pid, identity: owner, namespace, port, log };
  save([...records(), record]);
  await ready(record);
}
export async function startForwards(): Promise<void> {
  await stopForwards();
  try {
    await start("insecure", 3000);
    await start("secure", 3001);
  } catch (err) {
    await stopForwards();
    throw err;
  }
}
