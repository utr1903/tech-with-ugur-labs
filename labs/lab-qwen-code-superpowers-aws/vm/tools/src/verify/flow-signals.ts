/**
 * Measures how far the scripted Superpowers flow (brainstorm -> spec ->
 * plan -> subagent-driven implementation) got in a driven session: how
 * many rounds the resume driver ran, what it told the agent at each one,
 * whether the spec and plan got written, how many subagent calls the
 * implementation stage made, and why the driver stopped. Kept separate
 * from measured-signals.ts, which classifies a session's own tool calls,
 * because this walks the driver's own injected events as well.
 */
import type { TranscriptEvent } from "../transcript/events.js";
import type { ToolCall } from "./measured-signals.js";

export interface FlowSignals {
  rounds: number;
  replies: Record<string, number>;
  specWritten: boolean;
  planWritten: boolean;
  subagentCalls: number;
  finishReason: string | null;
}

const SPEC_PATH_RE = /\/docs\/superpowers\/specs\//;
const PLAN_PATH_RE = /\/docs\/superpowers\/plans\//;

/** True when a write_file/edit call's target path falls under the given docs subfolder. */
function writesUnder(calls: ToolCall[], pattern: RegExp): boolean {
  return calls.some((call) => {
    if (call.name !== "write_file" && call.name !== "edit") return false;
    const path = call.input.file_path;
    return typeof path === "string" && pattern.test(path);
  });
}

/** Tallies the driver's own injected events: how many replies per stage, and its finish record if any. */
function analyzeDriverEvents(events: TranscriptEvent[]): {
  replies: Record<string, number>;
  finishReason: string | null;
  finishedRounds: number | null;
} {
  const replies: Record<string, number> = {};
  let finishReason: string | null = null;
  let finishedRounds: number | null = null;

  for (const event of events) {
    if (event.kind === "driver-reply") {
      replies[event.stage] = (replies[event.stage] ?? 0) + 1;
    } else if (event.kind === "driver-finished") {
      finishReason = event.reason;
      finishedRounds = event.rounds;
    }
  }
  return { replies, finishReason, finishedRounds };
}

/** Measures the scripted flow's progress from the driver's injected events and the session's own tool calls. */
export function analyzeFlow(
  events: TranscriptEvent[],
  calls: ToolCall[],
): FlowSignals {
  const { replies, finishReason, finishedRounds } = analyzeDriverEvents(events);
  const replyCount = Object.values(replies).reduce((a, b) => a + b, 0);

  return {
    rounds: finishedRounds ?? 1 + replyCount,
    replies,
    specWritten: writesUnder(calls, SPEC_PATH_RE),
    planWritten: writesUnder(calls, PLAN_PATH_RE),
    subagentCalls: calls.filter((call) => call.name === "agent").length,
    finishReason,
  };
}
