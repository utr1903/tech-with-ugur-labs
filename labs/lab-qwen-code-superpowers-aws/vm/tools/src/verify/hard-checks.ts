/**
 * Runs the verifier's hard checks against a clean copy of the agent's
 * project: did the agent exit cleanly, does the project install and
 * type-check, do its own tests pass, and does it pass the task's
 * hidden acceptance tests and fixture outputs. The command-based
 * checks live in command-checks.ts and the per-fixture comparison in
 * fixture-check.ts; this file sequences the six checks and applies
 * the skip rules.
 */
import type { Logger } from "../logger.js";
import { describeExit, type RunInfo } from "../run/run-info.js";
import {
  acceptanceCheck,
  installCheck,
  logged,
  ownTestsCheck,
  typecheckCheck,
} from "./command-checks.js";
import { checkFixture } from "./fixture-check.js";
import type { RunStep } from "./process.js";
import { listFixtures, readTaskConfig } from "./task-config.js";

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

function skipped(name: string, detail: string): CheckResult {
  return { name, status: "skipped", detail };
}

/** Runs each fixture's configured command and compares its output to the expected JSON, aggregating the results. */
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
