import type { Logger } from "../logger.js";

/**
 * The answer API allows ten LLM calls per minute per project, and the
 * verification suite makes more than that. Grounded generation also regularly
 * outruns a short deadline. Both are worth waiting out; a permission problem is
 * not.
 */
const RETRYABLE_CODES = new Set([4, 8, 14]);

export function isRetryable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "number" && RETRYABLE_CODES.has(code);
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  logger: Logger,
  options: { attempts: number; baseDelayMs: number } = { attempts: 5, baseDelayMs: 8000 },
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === options.attempts) {
        throw err;
      }
      const delayMs = options.baseDelayMs * attempt;
      logger.warn({ attempt, delayMs }, "Retrying after a retryable API error...");
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
