import { ExecutionError } from "../execution/types.js";
import type { Logger } from "../logger.js";

// Backend exceptions can echo a submitted Job or invalid result bytes.
// Replace their contents before logging; preserve only our fixed error kinds.
export async function operation<T>(
  logger: Logger,
  name: string,
  fields: Record<string, unknown>,
  body: () => Promise<T>,
  summary: (result: T) => Record<string, unknown> = () => ({}),
): Promise<T> {
  try {
    logger.info(fields, `${name}...`);
    const result = await body();
    logger.info({ ...fields, ...summary(result) }, `${name} succeeded.`);
    return result;
  } catch (err) {
    const failure =
      err instanceof ExecutionError
        ? err
        : new ExecutionError("infrastructure");
    logger.error({ ...fields, err: failure }, `${name} failed.`);
    throw failure;
  }
}
