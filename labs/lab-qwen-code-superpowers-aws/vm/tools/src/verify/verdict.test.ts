import { describe, expect, it } from "vitest";
import { createStyle } from "../render/style.js";
import type { RunInfo } from "../run/run-info.js";
import type { CheckResult } from "./hard-checks.js";
import type { Measured } from "./measured.js";
import { buildVerdict, formatSummary } from "./verdict.js";

const run: RunInfo = {
  runId: "r1",
  task: "log-summary",
  status: "finished",
  startedAt: "2026-09-28T10:00:00Z",
  finishedAt: "2026-09-28T10:03:00Z",
  exitCode: 0,
  durationSeconds: 180,
  maxTurns: 150,
  maxWallTime: "45m",
  model: "m",
  maxRounds: null,
};

const measured: Measured = {
  turns: 8,
  toolCalls: { edit: 1, run_shell_command: 3, skill: 1, write_file: 2 },
  skillsLoaded: ["superpowers:test-driven-development"],
  skillCallsFailed: 0,
  firstSkillTurn: 1,
  testBeforeCode: "yes",
  ranTests: true,
  ranProgram: true,
  checkedAfterLastChange: "yes",
  flow: {
    rounds: 2,
    replies: { spec: 1 },
    specWritten: true,
    planWritten: false,
    subagentCalls: 1,
    finishReason: "complete",
  },
};

const passingChecks: CheckResult[] = [
  { name: "agent-exit", status: "pass", detail: "Agent exited 0" },
  { name: "install", status: "pass", detail: "installed dependencies" },
];

describe("buildVerdict", () => {
  it("passes when no hard check has failed, even if some are skipped", () => {
    const checks: CheckResult[] = [
      ...passingChecks,
      {
        name: "acceptance",
        status: "skipped",
        detail: "the task has no acceptance folder",
      },
    ];
    const verdict = buildVerdict(
      run,
      checks,
      measured,
      new Date("2026-09-28T10:05:00Z"),
    );
    expect(verdict).toEqual({
      runId: "r1",
      task: "log-summary",
      verdict: "pass",
      hardChecks: checks,
      measured,
      verifiedAt: "2026-09-28T10:05:00.000Z",
    });
  });

  it("fails when any hard check failed", () => {
    const checks: CheckResult[] = [
      ...passingChecks,
      { name: "typecheck", status: "fail", detail: "exit 1\nerror" },
    ];
    const verdict = buildVerdict(run, checks, measured, new Date());
    expect(verdict.verdict).toBe("fail");
  });
});

describe("formatSummary", () => {
  const style = createStyle(false);

  it("shows the verdict, one line per hard check, and the measured block", () => {
    const checks: CheckResult[] = [
      { name: "agent-exit", status: "pass", detail: "Agent exited 0" },
      { name: "install", status: "pass", detail: "installed dependencies" },
      {
        name: "typecheck",
        status: "fail",
        detail: "exit 1\nsrc/a.ts(1,1): error TS2322",
      },
      { name: "own-tests", status: "pass", detail: "tests passed" },
      {
        name: "acceptance",
        status: "skipped",
        detail: "the task has no acceptance folder",
      },
      {
        name: "fixtures",
        status: "skipped",
        detail: "the task has no acceptance folder",
      },
    ];
    const verdict = buildVerdict(run, checks, measured, new Date());
    const summary = formatSummary(verdict, style);

    expect(summary).toContain("VERDICT: FAIL");
    expect(summary).toContain("pass     agent-exit");
    expect(summary).toContain("FAIL     typecheck  exit 1");
    expect(summary).toContain(
      "skipped  acceptance  the task has no acceptance folder",
    );
    expect(summary).toContain("Process evidence (measured, not graded)");
    expect(summary).toContain(
      "skills loaded: superpowers:test-driven-development",
    );
    expect(summary).toContain("test before code: yes");
    expect(summary).toContain("ran tests: yes");
    expect(summary).toContain("ran program: yes");
    expect(summary).toContain("checked after last change: yes");
    expect(summary).toContain("turns: 8");
    expect(summary).toContain(
      "tool calls: edit:1, run_shell_command:3, skill:1, write_file:2",
    );
    expect(summary).toContain("rounds: 2");
    expect(summary).toContain("replies: spec:1");
    expect(summary).toContain("spec written: yes");
    expect(summary).toContain("plan written: no");
    expect(summary).toContain("subagent calls: 1");
    expect(summary).toContain("finish reason: complete");
    expect(summary.indexOf("tool calls:")).toBeLessThan(
      summary.indexOf("rounds:"),
    );
  });

  it("shows PASS and 'none' for skills when the agent loaded none", () => {
    const checks: CheckResult[] = [
      { name: "agent-exit", status: "pass", detail: "Agent exited 0" },
    ];
    const noSkills: Measured = { ...measured, skillsLoaded: [] };
    const verdict = buildVerdict(run, checks, noSkills, new Date());
    const summary = formatSummary(verdict, style);
    expect(summary).toContain("VERDICT: PASS");
    expect(summary).toContain("skills loaded: none");
  });

  it("shows 'none' for replies and finish reason when the driver never ran", () => {
    const checks: CheckResult[] = [
      { name: "agent-exit", status: "pass", detail: "Agent exited 0" },
    ];
    const noFlow: Measured = {
      ...measured,
      flow: {
        rounds: 1,
        replies: {},
        specWritten: false,
        planWritten: false,
        subagentCalls: 0,
        finishReason: null,
      },
    };
    const verdict = buildVerdict(run, checks, noFlow, new Date());
    const summary = formatSummary(verdict, style);
    expect(summary).toContain("rounds: 1");
    expect(summary).toContain("replies: none");
    expect(summary).toContain("finish reason: none");
  });
});
