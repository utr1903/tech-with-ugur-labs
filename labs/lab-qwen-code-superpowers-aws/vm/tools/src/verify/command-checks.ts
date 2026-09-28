/**
 * Runs the checks that boil down to "run one npm/node command and see
 * whether it succeeds": install, type-check, the agent's own tests,
 * and the hidden acceptance tests. Grouped here with the helpers that
 * turn a StepResult into a CheckResult and that log a check's
 * boundary, since these are the only checks that need them.
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../logger.js";
import type { CheckResult } from "./hard-checks.js";
import type { RunStep, StepResult } from "./process.js";
import { listAcceptanceTests } from "./task-config.js";

const MINUTES = 60_000;

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Renders a failed command step: "exit N" or "timed out", then the last 15 non-empty output lines. */
export function failureDetail(result: StepResult): string {
  const head = result.timedOut ? "timed out" : `exit ${result.code}`;
  const lines = `${result.stderr}\n${result.stdout}`
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(-15);
  return lines.length === 0 ? head : `${head}\n${lines.join("\n")}`;
}

/** Turns a finished command's StepResult into a pass/fail CheckResult. */
function toCheckResult(
  name: string,
  result: StepResult,
  passDetail: string,
): CheckResult {
  if (!result.timedOut && result.code === 0) {
    return { name, status: "pass", detail: passDetail };
  }
  return { name, status: "fail", detail: failureDetail(result) };
}

/** Logs a check's entry, success and failure around running it, per the operation-boundary pattern. */
export async function logged(
  logger: Logger | undefined,
  name: string,
  run: () => Promise<CheckResult> | CheckResult,
): Promise<CheckResult> {
  try {
    logger?.info({ check: name }, "Running check...");
    const result = await run();
    logger?.info(
      { check: name, status: result.status },
      "Running check succeeded.",
    );
    return result;
  } catch (err) {
    logger?.error({ err, check: name }, "Running check failed.");
    throw err;
  }
}

/** Fails without running a command when there's no lockfile in the workspace; else runs `npm ci`. */
export async function installCheck(
  workDir: string,
  runStep: RunStep,
): Promise<CheckResult> {
  if (!(await pathExists(join(workDir, "package-lock.json")))) {
    return {
      name: "install",
      status: "fail",
      detail: "no package-lock.json in the workspace",
    };
  }
  const result = await runStep("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd: workDir,
    timeoutMs: 5 * MINUTES,
  });
  return toCheckResult("install", result, "installed dependencies");
}

/** Runs the project's own typecheck script. */
export async function typecheckCheck(
  workDir: string,
  runStep: RunStep,
): Promise<CheckResult> {
  const result = await runStep("npm", ["run", "--silent", "typecheck"], {
    cwd: workDir,
    timeoutMs: 2 * MINUTES,
  });
  return toCheckResult("typecheck", result, "no type errors");
}

/** Runs the agent's own test suite with CI=1. */
export async function ownTestsCheck(
  workDir: string,
  runStep: RunStep,
): Promise<CheckResult> {
  const result = await runStep("npm", ["test", "--silent"], {
    cwd: workDir,
    timeoutMs: 5 * MINUTES,
    env: { CI: "1" },
  });
  return toCheckResult("own-tests", result, "tests passed");
}

/** Runs the task's hidden acceptance tests via `node --test`, or skips when there are none. */
export async function acceptanceCheck(
  workDir: string,
  acceptanceDir: string,
  runStep: RunStep,
): Promise<CheckResult> {
  const files = await listAcceptanceTests(acceptanceDir);
  if (files.length === 0) {
    return {
      name: "acceptance",
      status: "skipped",
      detail: "no acceptance tests in the folder",
    };
  }
  const result = await runStep("node", ["--test", ...files], {
    cwd: workDir,
    timeoutMs: 5 * MINUTES,
    env: { TASK_WORKDIR: workDir },
  });
  return toCheckResult("acceptance", result, "acceptance tests passed");
}
