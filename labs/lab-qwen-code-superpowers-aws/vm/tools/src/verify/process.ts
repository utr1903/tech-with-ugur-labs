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
// How long to wait, after killing the process group, for `close` to fire
// before giving up on it and resolving anyway. A grandchild that inherited
// the stdio pipes (e.g. `sh -c tsc` or `sh -c vitest`) can keep them open
// past its parent's death, so `close` alone isn't a reliable timeout signal.
const KILL_GRACE_MS = 2_000;

/** Appends a chunk to a captured stream, capping it at 1 MB with a trailing note. */
function appendCapped(buffer: string, chunk: string): string {
  if (buffer.endsWith(TRUNCATION_NOTE)) return buffer;
  const next = buffer + chunk;
  if (next.length <= MAX_OUTPUT_LENGTH) return next;
  return `${next.slice(0, MAX_OUTPUT_LENGTH)}${TRUNCATION_NOTE}`;
}

/** Kills a whole process group so grandchildren die with it, falling back to just the one process. */
function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

/** Runs a command with a timeout, resolving with its outcome instead of throwing. */
export const runStep: RunStep = (command, args, { cwd, timeoutMs, env }) =>
  new Promise((resolve) => {
    // `detached: true` makes the child its own process-group leader, so a
    // grandchild it spawns (which inherits the group) can be killed too.
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (result: StepResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) killGroup(child.pid);
      // Belt-and-braces: if something still holds the stdio pipes open,
      // `close` may never fire. Give it a grace period, then resolve anyway.
      setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish({ code: null, stdout, stderr, timedOut: true });
      }, KILL_GRACE_MS);
    }, timeoutMs);

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
