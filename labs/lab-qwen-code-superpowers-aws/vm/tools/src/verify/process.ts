/**
 * Runs one external command to completion or to a timeout, capturing
 * its output. It never throws: the verifier treats every check's
 * outcome (including "the command doesn't exist" or "it hung") as
 * data to report, not as an exception that would abort the run.
 */
import { spawn } from "node:child_process";

export interface StepResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type RunStep = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; env?: Record<string, string> },
) => Promise<StepResult>;

const MAX_OUTPUT_LENGTH = 1024 * 1024;
const TRUNCATION_NOTE = "\n[output truncated]";

/** Appends a chunk to a captured stream, capping it at 1 MB with a trailing note. */
function appendCapped(buffer: string, chunk: string): string {
  if (buffer.endsWith(TRUNCATION_NOTE)) return buffer;
  const next = buffer + chunk;
  if (next.length <= MAX_OUTPUT_LENGTH) return next;
  return `${next.slice(0, MAX_OUTPUT_LENGTH)}${TRUNCATION_NOTE}`;
}

/** Runs a command with a timeout, resolving with its outcome instead of throwing. */
export const runStep: RunStep = (command, args, { cwd, timeoutMs, env }) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const finish = (result: StepResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk.toString("utf8"));
    });
    child.on("error", (err) => {
      finish({ code: null, stdout: "", stderr: err.message, timedOut: false });
    });
    child.on("close", (code) => {
      finish({ code, stdout, stderr, timedOut });
    });
  });
