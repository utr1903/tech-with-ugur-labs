import type { ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { spawnKubectl } from "./cluster.js";

export function startPortForward(
  service: string,
  localPort: number,
  remotePort: number,
): ChildProcess {
  return spawnKubectl(
    ["port-forward", `svc/${service}`, `${localPort}:${remotePort}`],
    { stdio: "ignore" },
  );
}

export async function waitForHttp(
  url: string,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(1_000);
  }
  throw new Error(`${url} did not become ready: ${String(lastError)}`);
}
