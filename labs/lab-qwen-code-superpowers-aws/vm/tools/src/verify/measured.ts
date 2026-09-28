/**
 * Extracts "process evidence" from a parsed transcript: which skills
 * the agent loaded, whether it wrote a test before the code it
 * exercises, whether it ran its tests and the program under test
 * afterwards, and simple tool-call counts. This is reported in the
 * verdict as measured signal, never graded — the hard checks in
 * hard-checks.ts are the only thing that decides pass/fail. The
 * classification rules live in measured-signals.ts; this file only
 * walks the transcript once and assembles their results.
 */
import type { ContentBlock, TranscriptEvent } from "../transcript/events.js";
import { analyzeFlow, type FlowSignals } from "./flow-signals.js";
import {
  analyzeFiles,
  analyzeShell,
  analyzeSkills,
  computeCheckedAfterLastChange,
  computeTestBeforeCode,
  type ToolCall,
} from "./measured-signals.js";

export interface Measured {
  turns: number;
  toolCalls: Record<string, number>;
  skillsLoaded: string[];
  skillCallsFailed: number;
  firstSkillTurn: number | null;
  testBeforeCode: "yes" | "no" | "unknown";
  ranTests: boolean;
  ranProgram: boolean | null;
  checkedAfterLastChange: "yes" | "no" | "unknown";
  flow: FlowSignals;
}

/** Appends the tool_use blocks of one assistant turn to `calls`, returning the order counter after them. */
function recordAssistantCalls(
  blocks: ContentBlock[],
  turn: number,
  order: number,
  calls: ToolCall[],
): number {
  let nextOrder = order;
  for (const block of blocks) {
    if (block.type !== "tool_use") continue;
    nextOrder += 1;
    calls.push({
      order: nextOrder,
      turn,
      id: block.id,
      name: block.name,
      input: block.input,
    });
  }
  return nextOrder;
}

/** Walks the transcript once, tracking the current turn and every tool_use block's order and result. */
function collectToolCalls(events: TranscriptEvent[]): {
  turns: number;
  calls: ToolCall[];
  results: Map<string, boolean>;
} {
  let turn = 0;
  let turnStarts = 0;
  let lastNumTurns = 0;
  let order = 0;
  const calls: ToolCall[] = [];
  const results = new Map<string, boolean>();

  for (const event of events) {
    if (event.kind === "turn-start") {
      turn += 1;
      turnStarts += 1;
    } else if (event.kind === "result") {
      lastNumTurns = event.numTurns;
    } else if (event.kind === "assistant") {
      order = recordAssistantCalls(event.blocks, turn, order, calls);
    } else if (event.kind === "tool-result") {
      results.set(event.toolUseId, event.isError);
    }
  }
  return { turns: turnStarts > 0 ? turnStarts : lastNumTurns, calls, results };
}

/** Counts tool_use blocks by tool name, with the keys sorted alphabetically. */
function countToolCalls(calls: ToolCall[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const call of calls) {
    counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
  }
  const sorted: Record<string, number> = {};
  for (const name of [...counts.keys()].sort()) {
    sorted[name] = counts.get(name) as number;
  }
  return sorted;
}

/** Analyzes a parsed transcript into the measured process-evidence fields reported alongside a verdict. */
export function analyzeTranscript(
  events: TranscriptEvent[],
  programPattern: string | null,
): Measured {
  const { turns, calls, results } = collectToolCalls(events);
  const { skillsLoaded, skillCallsFailed, firstSkillTurn } = analyzeSkills(
    calls,
    results,
  );
  const { firstTestOrder, firstSourceOrder, lastSourceOrder } =
    analyzeFiles(calls);
  const { ranTests, ranProgram, lastTestRunOrder, lastProgramRunOrder } =
    analyzeShell(calls, programPattern);

  return {
    turns,
    toolCalls: countToolCalls(calls),
    skillsLoaded,
    skillCallsFailed,
    firstSkillTurn,
    testBeforeCode: computeTestBeforeCode(firstTestOrder, firstSourceOrder),
    ranTests,
    ranProgram,
    checkedAfterLastChange: computeCheckedAfterLastChange(
      lastSourceOrder,
      lastTestRunOrder,
      programPattern,
      lastProgramRunOrder,
    ),
    flow: analyzeFlow(events, calls),
  };
}
