import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function postAssistant(
  base: string,
  body: { document: string; question: string },
): Promise<{ answer: string }> {
  const response = await fetch(`${base}/assistant`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as { answer: string };
}

export async function postProcess(
  base: string,
  body: { instruction: string; data: string },
): Promise<{ result: string }> {
  const response = await fetch(`${base}/process`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as { result: string };
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

export function truncateEvidence(file: string): void {
  try {
    writeFileSync(file, "");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

export function readEvidence(file: string): string {
  if (!existsSync(file)) {
    return "";
  }
  return readFileSync(file, "utf8");
}

export function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") {
    return 0;
  }
  return haystack.split(needle).length - 1;
}
