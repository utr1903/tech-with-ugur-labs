import type { Logger } from "../logger.js";
import { safeExecutionError } from "./errors.js";

// Backend exceptions can echo a submitted Job or invalid result bytes.
// Preserve safe diagnostic fields and bounded causes while omitting raw bytes.
export async function operation<T>(
  logger: Logger,
  name: string,
  fields: Record<string, unknown>,
  body: () => Promise<T>,
  summary: (result: T) => Record<string, unknown> = () => ({}),
): Promise<T> {
  // Emit lifecycle events around the operation without logging its returned data by default.
  try {
    logger.info(fields, `${name}...`);
    const result = await body();
    logger.info({ ...fields, ...summary(result) }, `${name} succeeded.`);
    return result;
  } catch (err) {
    // Replace potentially command-bearing backend errors before logging and propagating them.
    const failure = safeExecutionError(err);
    logger.error({ ...fields, err: failure }, `${name} failed.`);
    throw failure;
  }
}
