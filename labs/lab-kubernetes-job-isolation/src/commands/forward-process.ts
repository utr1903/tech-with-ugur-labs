import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { safeProcessError } from "../lib/errors.js";
import type { Logger } from "../logger.js";
import { context } from "./settings.js";

export type Forward = {
  pid: number;
  identity: string;
  namespace: string;
  port: number;
  log: string;
};
export function args(namespace: string, port: number): string[] {
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
export function identity(pid: number, logger?: Logger): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  const fields = {
    command: "ps",
    args: ["-p", String(pid), "-o", "lstart=", "-o", "command="],
    pid,
  };
  try {
    logger?.info(fields, "Checking process identity...");
    // Start time plus argv protects against PID reuse when stopping a forward.
    const result = spawnSync(fields.command, fields.args, { encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 1)
      throw new Error("Process inspection failed.");
    logger?.info(
      { ...fields, exitCode: result.status, exists: result.status === 0 },
      "Checking process identity succeeded.",
    );
    // ps exit1 means the process is absent, an expected result during shutdown.
    return result.status === 0 ? result.stdout.trim() : undefined;
  } catch (err) {
    logger?.error(
      { ...fields, err: safeProcessError(err) },
      "Checking process identity failed.",
    );
    throw err;
  }
}
export async function stopOwned(
  record: Forward,
  logger?: Logger,
): Promise<void> {
  const current = identity(record.pid, logger);
  const suffix = `kubectl ${args(record.namespace, record.port).join(" ")}`;
  if (!current || current !== record.identity || !current.endsWith(suffix))
    return;
  // Signal only the positively matched kubectl forward, then await its absence.
  process.kill(record.pid, "SIGTERM");
  for (
    let attempt = 0;
    attempt < 100 && identity(record.pid, logger) === current;
    attempt++
  )
    await delay(50);
  if (identity(record.pid, logger) === current)
    throw new Error("Owned port forward did not stop.");
}
