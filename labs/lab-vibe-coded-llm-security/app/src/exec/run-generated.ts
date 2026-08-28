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
  // Node's child_process.exec sets `signal: null` for an ordinary non-zero
  // exit, so `signal !== undefined` is NOT a valid timeout test — it would
  // misclassify every exec failure as a timeout. A real timeout kills the
  // child, so `killed === true` (optionally paired with our killSignal) is
  // the actual signal Node gives us.
  if (!(err instanceof Error)) return false;
  const execErr = err as ExecError;
  return execErr.killed === true || execErr.signal === "SIGKILL";
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
