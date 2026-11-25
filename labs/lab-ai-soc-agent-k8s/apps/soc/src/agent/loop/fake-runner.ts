import type {
  BetaMessage,
  BetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Runner, RunnerFactory, ToolRunnerParams } from "./request.js";

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };
export type Step = {
  blocks: Block[];
  stop_reason?: string;
  usage?: Partial<Record<string, number>>;
};

type RunnableLike = { name?: string; run?: (input: unknown) => unknown };

function reply(step: Step, n: number): BetaMessage {
  return {
    id: `msg_${n}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: step.blocks,
    stop_reason: step.stop_reason ?? "end_turn",
    stop_details: null,
    usage: { input_tokens: 100, output_tokens: 50, ...step.usage },
  } as unknown as BetaMessage;
}

async function answerTools(params: ToolRunnerParams, blocks: Block[]) {
  const tools = params.tools as RunnableLike[];
  const results = [];
  for (const b of blocks) {
    if (b.type !== "tool_use") continue;
    const out = await tools.find((t) => t.name === b.name)?.run?.(b.input);
    results.push({ type: "tool_result", tool_use_id: b.id, content: out });
  }
  return results;
}

/**
 * Mimics the SDK runner: a reply is yielded first; its tools run only when the
 * consumer asks for the next turn (or calls generateToolResponse, which is
 * cached), and params.messages then gains the assistant reply plus a user
 * tool_result turn. max_iterations stops before the next request, leaving the
 * history ending in that tool_result turn.
 */
function fakeRunner(params: ToolRunnerParams, steps: Step[]): Runner {
  const messages: BetaMessageParam[] = [...params.messages];
  let answered: Promise<unknown[]> | undefined;
  let current: Step | undefined;
  const answer = () => {
    answered ??= answerTools(params, current?.blocks ?? []);
    return answered;
  };
  return {
    params: { messages },
    generateToolResponse: answer,
    async *[Symbol.asyncIterator]() {
      for (const [i, step] of steps.entries()) {
        if (params.max_iterations && i >= params.max_iterations) return;
        current = step;
        answered = undefined;
        yield reply(step, i);
        messages.push({ role: "assistant", content: step.blocks });
        if (step.stop_reason && step.stop_reason !== "tool_use") return;
        const results = await answer();
        if (results.length === 0) return;
        messages.push({ role: "user", content: results as never });
      }
    },
  };
}

export function fakeFactory(scripts: Step[][]) {
  const calls: { params: ToolRunnerParams }[] = [];
  const factory: RunnerFactory = (params) => {
    const steps = scripts[calls.length] ?? [];
    calls.push({ params });
    return fakeRunner(params, steps);
  };
  return { factory, calls };
}

type Raw = Record<string, string>;

function blocksOf(m: BetaMessageParam): Raw[] {
  return Array.isArray(m.content) ? (m.content as unknown as Raw[]) : [];
}

function blockProblems(b: Raw, open: Set<string>): string[] {
  if (b.type === "tool_use" && b.id) open.add(b.id);
  if (b.type === "tool_result" && !open.delete(b.tool_use_id ?? "")) {
    return [`unmatched ${b.tool_use_id}`];
  }
  return [];
}

/** Problems that would make the API reject this history; empty when valid. */
export function historyProblems(messages: BetaMessageParam[]): string[] {
  const problems: string[] = [];
  const open = new Set<string>();
  for (const [i, m] of messages.entries()) {
    if (i > 0 && messages[i - 1]?.role === m.role) problems.push(`repeat@${i}`);
    for (const b of blocksOf(m)) problems.push(...blockProblems(b, open));
  }
  for (const id of open) problems.push(`unanswered ${id}`);
  return problems;
}
