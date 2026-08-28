import { existsSync, readFileSync } from "node:fs";

export interface RunResponse {
  output: string;
  toolsCalled: string[];
  naiveScan: { clean: boolean };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function postRun(
  base: string,
  task: string,
): Promise<RunResponse> {
  const response = await fetch(`${base}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task }),
  });
  return (await response.json()) as RunResponse;
}

export async function waitForHealth(
  base: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) {
        return;
      }
    } catch (err) {
      lastError = err;
    }
    await sleep(1_000);
  }
  throw new Error(
    `waitForHealth: ${base}/health did not become ready within ${timeoutMs}ms (last error: ${String(lastError)})`,
  );
}

export function readEvidence(file: string): string {
  if (!existsSync(file)) {
    return "";
  }
  return readFileSync(file, "utf8");
}
