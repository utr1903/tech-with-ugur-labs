/**
 * Combines the hard checks and the measured process evidence into
 * one verdict for a run, and renders it as the human-readable summary
 * the verify command prints to stdout. The hard checks alone decide
 * pass or fail; the measured block is process evidence, reported but
 * never graded.
 */
import type { Color, Style } from "../render/style.js";
import type { RunInfo } from "../run/run-info.js";
import type { CheckResult, CheckStatus } from "./hard-checks.js";
import type { Measured } from "./measured.js";

export interface Verdict {
  runId: string;
  task: string;
  verdict: "pass" | "fail";
  hardChecks: CheckResult[];
  measured: Measured;
  verifiedAt: string;
}

/** Builds a run's verdict: "fail" iff any hard check status is "fail" (skipped checks alone don't fail it). */
export function buildVerdict(
  run: RunInfo,
  hardChecks: CheckResult[],
  measured: Measured,
  now: Date,
): Verdict {
  const failed: CheckStatus = "fail";
  return {
    runId: run.runId,
    task: run.task,
    verdict: hardChecks.some((c) => c.status === failed) ? "fail" : "pass",
    hardChecks,
    measured,
    verifiedAt: now.toISOString(),
  };
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: "pass",
  fail: "FAIL",
  skipped: "skipped",
};

const STATUS_COLOR: Record<CheckStatus, Color> = {
  pass: "green",
  fail: "red",
  skipped: "yellow",
};

/** Renders one hard check as a padded, colored line; a passing check's detail is omitted as uninteresting. */
function formatCheckLine(check: CheckResult, style: Style): string {
  const label = style.paint(
    STATUS_COLOR[check.status],
    STATUS_LABEL[check.status].padEnd(9),
  );
  if (check.status === "pass") return `  ${label}${check.name}`;
  const detail = check.detail.split("\n")[0];
  return `  ${label}${check.name}  ${detail}`;
}

/** Renders the "not checked" case for ranProgram, which is null when the task has no program pattern. */
function formatRanProgram(value: boolean | null): string {
  if (value === null) return "not checked (no program pattern for this task)";
  return value ? "yes" : "no";
}

/** Renders the measured process-evidence block: reported for the reader, never part of the verdict. */
function formatMeasuredLines(measured: Measured, style: Style): string[] {
  const skills =
    measured.skillsLoaded.length > 0
      ? measured.skillsLoaded.join(", ")
      : "none";
  const toolCalls = Object.entries(measured.toolCalls)
    .map(([name, count]) => `${name}:${count}`)
    .join(", ");
  return [
    style.paint("bold", "Process evidence (measured, not graded)"),
    `  skills loaded: ${skills}`,
    `  test before code: ${measured.testBeforeCode}`,
    `  ran tests: ${measured.ranTests ? "yes" : "no"}`,
    `  ran program: ${formatRanProgram(measured.ranProgram)}`,
    `  checked after last change: ${measured.checkedAfterLastChange}`,
    `  turns: ${measured.turns}`,
    `  tool calls: ${toolCalls.length > 0 ? toolCalls : "none"}`,
    ...formatFlowLines(measured.flow),
  ];
}

/** Renders the scripted-flow block that follows the process-evidence lines: how far the driven session got. */
function formatFlowLines(flow: Measured["flow"]): string[] {
  const replies = Object.entries(flow.replies)
    .map(([stage, count]) => `${stage}:${count}`)
    .join(", ");
  return [
    `  rounds: ${flow.rounds}`,
    `  replies: ${replies.length > 0 ? replies : "none"}`,
    `  spec written: ${flow.specWritten ? "yes" : "no"}`,
    `  plan written: ${flow.planWritten ? "yes" : "no"}`,
    `  subagent calls: ${flow.subagentCalls}`,
    `  finish reason: ${flow.finishReason ?? "none"}`,
  ];
}

/** Formats a verdict as the human-readable summary the verify command prints to stdout. */
export function formatSummary(verdict: Verdict, style: Style): string {
  const label = verdict.verdict === "pass" ? "PASS" : "FAIL";
  const color: Color = verdict.verdict === "pass" ? "green" : "red";
  const lines = [
    style.paint(["bold", color], `VERDICT: ${label}`),
    "",
    ...verdict.hardChecks.map((c) => formatCheckLine(c, style)),
    "",
    ...formatMeasuredLines(verdict.measured, style),
  ];
  return `${lines.join("\n")}\n`;
}
