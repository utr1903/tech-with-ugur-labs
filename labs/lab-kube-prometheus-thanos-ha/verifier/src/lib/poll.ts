import type { Logger } from "../logger.js";

export function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// Retries attempt() until it resolves or timeoutSeconds elapse; rethrows the
// last error on deadline so the failure cause is never swallowed.
export async function pollUntil<T>({
  logger,
  description,
  timeoutSeconds,
  intervalSeconds,
  attempt,
}: {
  logger: Logger;
  description: string;
  timeoutSeconds: number;
  intervalSeconds: number;
  attempt: () => Promise<T>;
}): Promise<T> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastErr: unknown = new Error(`pollUntil(${description}) never attempted`);
  while (Date.now() < deadline) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      logger.debug({ err, description }, "Polling attempt failed; retrying...");
      await sleep(intervalSeconds);
    }
  }
  logger.error(
    { err: lastErr, description, timeoutSeconds },
    "Polling timed out.",
  );
  throw lastErr;
}
