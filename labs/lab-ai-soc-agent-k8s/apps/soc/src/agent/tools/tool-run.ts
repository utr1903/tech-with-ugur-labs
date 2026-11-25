import type { Logger } from "../../logger.js";

/** An expected failure the model can act on (bad input, upstream down). */
export class ToolFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const MAX_MESSAGE = 500;

function errorBody(code: string, message: string): string {
  return JSON.stringify({
    error: { code, message: message.slice(0, MAX_MESSAGE) },
  });
}

/**
 * Runs one tool call with the operation-boundary log lines. A tool never
 * throws into the runner: failures come back as `{error:{code,message}}`
 * so the model can read them and adjust.
 */
export async function runLogged(
  logger: Logger,
  tool: string,
  input: unknown,
  body: () => Promise<string>,
): Promise<string> {
  try {
    logger.info({ tool, input }, `Running tool ${tool}...`);
    const out = await body();
    logger.info({ tool, bytes: out.length }, `Running tool ${tool} succeeded.`);
    return out;
  } catch (err) {
    logger.error({ err, tool, input }, `Running tool ${tool} failed.`);
    const code = err instanceof ToolFailure ? err.code : "tool_failed";
    return errorBody(code, err instanceof Error ? err.message : String(err));
  }
}
