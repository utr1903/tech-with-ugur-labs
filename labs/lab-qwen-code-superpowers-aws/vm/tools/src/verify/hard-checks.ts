/**
 * Runs the verifier's hard checks against a clean copy of the agent's
 * project: did the agent exit cleanly, does the project install and
 * type-check, do its own tests pass, and does it pass the task's
 * hidden acceptance tests and fixture outputs. Each check is a small
 * function so a failing one is easy to read and to test in isolation;
 * runHardChecks only sequences them and applies the skip rules.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Logger } from "../logger.js";
import { describeExit, type RunInfo } from "../run/run-info.js";
import type { RunStep, StepResult } from "./process.js";
import {
  type Fixture,
  listAcceptanceTests,
  listFixtures,
  readTaskConfig,
} from "./task-config.js";

export type CheckStatus = "pass" | "fail" | "skipped";

/** One hard check's outcome: its name, pass/fail/skipped status, and a human-readable reason. */
export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

/** Input to runHardChecks: the finished run, its clean workspace copy, and the task's acceptance folder (if any). */
export interface HardCheckInput {
  run: RunInfo;
  workDir: string;
  acceptanceDir: string | null;
  runStep: RunStep;
  logger?: Logger;
}

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
function failureDetail(result: StepResult): string {
  const head = result.timedOut ? "timed out" : `exit ${result.code}`;
  const lines = `${result.stderr}\n${result.stdout}`
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(-15);
  return lines.length === 0 ? head : `${head}\n${lines.join("\n")}`;
}

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

function agentExitCheck(run: RunInfo): CheckResult {
  const detail =
    run.exitCode === 0
      ? "Agent exited 0"
      : `Agent ${describeExit(run.exitCode)}`;
  return {
    name: "agent-exit",
    status: run.exitCode === 0 ? "pass" : "fail",
    detail,
  };
}

async function installCheck(
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

async function typecheckCheck(
  workDir: string,
  runStep: RunStep,
): Promise<CheckResult> {
  const result = await runStep("npm", ["run", "--silent", "typecheck"], {
    cwd: workDir,
    timeoutMs: 2 * MINUTES,
  });
  return toCheckResult("typecheck", result, "no type errors");
}

async function ownTestsCheck(
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

async function acceptanceCheck(
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

/** Top-level keys where expected and actual values are not deep-equal, sorted. */
function diffingKeys(
  expected: Record<string, unknown>,
  actual: unknown,
): string[] {
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
    return Object.keys(expected).sort();
  }
  const actualRecord = actual as Record<string, unknown>;
  const keys = new Set([
    ...Object.keys(expected),
    ...Object.keys(actualRecord),
  ]);
  return [...keys]
    .filter((k) => !isDeepStrictEqual(expected[k], actualRecord[k]))
    .sort();
}

/** Compares one fixture's step result against its expected JSON; returns a problem string, or null when it matches. */
async function checkFixture(
  fixture: Fixture,
  result: StepResult,
): Promise<string | null> {
  if (result.timedOut) return "timed out";
  if (result.code !== 0) return `exit ${result.code}`;
  let actual: unknown;
  try {
    actual = JSON.parse(result.stdout);
  } catch {
    return "output is not JSON";
  }
  const expected = JSON.parse(
    await readFile(fixture.expectedPath, "utf8"),
  ) as Record<string, unknown>;
  const diffs = diffingKeys(expected, actual);
  return diffs.length === 0 ? null : `${diffs.join(", ")} differs`;
}

async function fixturesCheck(
  workDir: string,
  acceptanceDir: string,
  runStep: RunStep,
): Promise<CheckResult> {
  const config = await readTaskConfig(acceptanceDir);
  const fixtures = await listFixtures(acceptanceDir);
  const [command, ...baseArgs] = config.runCommand;
  if (!command) throw new Error("verify.json: runCommand is empty");
  const problems: string[] = [];
  for (const fixture of fixtures) {
    const result = await runStep(command, [...baseArgs, fixture.inputPath], {
      cwd: workDir,
      timeoutMs: 60_000,
    });
    const problem = await checkFixture(fixture, result);
    if (problem) problems.push(`${fixture.name}: ${problem}`);
  }
  if (problems.length === 0) {
    return {
      name: "fixtures",
      status: "pass",
      detail: `${fixtures.length}/${fixtures.length} fixtures match`,
    };
  }
  return { name: "fixtures", status: "fail", detail: problems.join("; ") };
}

function skipped(name: string, detail: string): CheckResult {
  return { name, status: "skipped", detail };
}

async function logged(
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

/** Runs the six hard checks in order, skipping downstream checks that a failed install or a missing acceptance folder makes meaningless. */
export async function runHardChecks(
  input: HardCheckInput,
): Promise<CheckResult[]> {
  const { run, workDir, acceptanceDir, runStep, logger } = input;
  const results: CheckResult[] = [];

  results.push(await logged(logger, "agent-exit", () => agentExitCheck(run)));

  const install = await logged(logger, "install", () =>
    installCheck(workDir, runStep),
  );
  results.push(install);
  if (install.status !== "pass") {
    const detail = "skipped because install failed";
    for (const name of ["typecheck", "own-tests", "acceptance", "fixtures"]) {
      results.push(await logged(logger, name, () => skipped(name, detail)));
    }
    return results;
  }

  results.push(
    await logged(logger, "typecheck", () => typecheckCheck(workDir, runStep)),
  );
  results.push(
    await logged(logger, "own-tests", () => ownTestsCheck(workDir, runStep)),
  );

  if (!acceptanceDir) {
    const detail = "the task has no acceptance folder";
    results.push(
      await logged(logger, "acceptance", () => skipped("acceptance", detail)),
    );
    results.push(
      await logged(logger, "fixtures", () => skipped("fixtures", detail)),
    );
    return results;
  }

  results.push(
    await logged(logger, "acceptance", () =>
      acceptanceCheck(workDir, acceptanceDir, runStep),
    ),
  );
  results.push(
    await logged(logger, "fixtures", () =>
      fixturesCheck(workDir, acceptanceDir, runStep),
    ),
  );
  return results;
}
