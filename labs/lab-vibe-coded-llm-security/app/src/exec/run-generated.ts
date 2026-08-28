import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "../logger.js";

const promisifiedExec = promisify(execCallback);

const FENCE_PATTERN = /^```[ \t]*([a-zA-Z0-9_+-]*)\n([\s\S]*?)\n?```$/;

// Strips a ``` fenced code block (with an optional leading language token,
// e.g. "sh" or "bash") that models like to wrap generated commands in.
export function sanitizeCommand(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(FENCE_PATTERN);
  if (fenced) {
    return fenced[2].trim();
  }
  return trimmed;
}

export interface ExecDeps {
  logger: Logger;
  execFn?: (cmd: string) => Promise<{ stdout: string; stderr: string }>;
}

interface ExecError extends Error {
  killed?: boolean;
  signal?: string | null;
  stdout?: string;
}

function isTimeoutError(err: unknown): err is ExecError {
  return (
    err instanceof Error &&
    (Boolean((err as ExecError).killed) ||
      (err as ExecError).signal !== undefined)
  );
}

// DELIBERATELY VULNERABLE: executing model-generated text as a shell command is remote code execution by design.
export async function runGeneratedCommand(
  deps: ExecDeps,
  command: string,
): Promise<string> {
  const { logger, execFn } = deps;
  const run =
    execFn ??
    ((cmd: string) =>
      promisifiedExec(cmd, { timeout: 8000, killSignal: "SIGKILL" }));
  const sanitized = sanitizeCommand(command);

  try {
    logger.info({ command: sanitized }, "Running generated command...");
    const { stdout } = await run(sanitized);
    logger.info({ command: sanitized }, "Running generated command succeeded.");
    return stdout;
  } catch (err) {
    if (isTimeoutError(err)) {
      // The shell already connected/ran before the timeout fired, so the
      // attack landed regardless of whether we ever see it finish.
      logger.warn(
        { err, command: sanitized },
        "Running generated command timed out (command already ran).",
      );
      return err.stdout ?? "";
    }
    logger.error(
      { err, command: sanitized },
      "Running generated command failed.",
    );
    throw err;
  }
}
