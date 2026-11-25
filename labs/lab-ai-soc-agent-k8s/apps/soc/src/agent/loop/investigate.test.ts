import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { makeDeps } from "../tools/test-support.js";
import { type RunnerFactory, runInvestigation } from "./investigate.js";

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };
type Step = {
  blocks: Block[];
  stop_reason?: string;
  usage?: Partial<Record<string, number>>;
};

const VERDICT = {
  verdict: "malicious",
  confidence: 0.9,
  summary: "Reverse shell from storefront pod.",
  attack_techniques: [
    { id: "T1609", name: "Container Administration Command" },
  ],
  timeline: [],
  affected: [{ kind: "Pod", namespace: "storefront", name: "web-1" }],
  injection_suspected: false,
  proposal_ids: [],
};

function message(step: Step, n: number): BetaMessage {
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

type RunnableLike = { name?: string; run?: (input: unknown) => unknown };

async function playTools(
  params: Parameters<RunnerFactory>[0],
  blocks: Block[],
) {
  const tools = params.tools as RunnableLike[];
  for (const b of blocks) {
    if (b.type !== "tool_use") continue;
    await tools.find((t) => t.name === b.name)?.run?.(b.input);
  }
}

/** Fake runner: each step is one model turn; tool_use blocks run the real tools. */
function fakeFactory(scripts: Step[][]) {
  const calls: { params: Parameters<RunnerFactory>[0] }[] = [];
  const factory: RunnerFactory = (params) => {
    const steps = scripts[calls.length] ?? [];
    calls.push({ params });
    return {
      async *[Symbol.asyncIterator]() {
        let n = 0;
        for (const step of steps) {
          await playTools(params, step.blocks);
          yield message(step, n++);
        }
      },
    };
  };
  return { factory, calls };
}

function run(
  scripts: Step[][],
  extra: { tokenBudget?: number; mode?: "investigate" | "hunt" } = {},
) {
  const { factory, calls } = fakeFactory(scripts);
  const result = runInvestigation(
    { mode: extra.mode ?? "investigate", alerts: [] },
    {
      ...makeDeps(),
      createRunner: factory,
      tokenBudget: extra.tokenBudget ?? 400000,
      maxIterations: 25,
    },
  );
  return { result, calls };
}

const submit: Block = {
  type: "tool_use",
  id: "t1",
  name: "submit_verdict",
  input: VERDICT,
};

describe("runInvestigation", () => {
  it("records the verdict and sums usage on the happy path", async () => {
    const { result, calls } = run([
      [
        {
          blocks: [
            { type: "tool_use", id: "a", name: "get_alert_context", input: {} },
          ],
          stop_reason: "tool_use",
        },
        { blocks: [submit], stop_reason: "tool_use" },
        { blocks: [{ type: "text", text: "done" }] },
      ],
    ]);
    const r = await result;
    expect(r.verdicts).toHaveLength(1);
    expect(r.verdicts[0]?.verdict).toBe("malicious");
    expect(r.usage.input_tokens).toBe(300);
    expect(r.usage.output_tokens).toBe(150);
    expect(r.usage.iterations).toBe(3);
    expect(r.budgetExhausted).toBe(false);
    expect(r.stopReason).toBe("end_turn");
    expect(r.model).toBe("claude-opus-5-5");
    expect(calls).toHaveLength(1);
  });

  it("sends the pinned request params", async () => {
    const { result, calls } = run([[{ blocks: [submit] }]]);
    await result;
    const p = calls[0]?.params as unknown as Record<string, unknown>;
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.max_tokens).toBe(16000);
    expect(p.thinking).toEqual({ type: "adaptive" });
    expect(p.output_config).toEqual({ effort: "medium" });
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(p.fallbacks).toBe("default");
    expect(p.max_iterations).toBe(25);
    expect(p).not.toHaveProperty("temperature");
    expect(p).not.toHaveProperty("tool_choice");
    expect(JSON.stringify(p.system)).toContain('"ephemeral"');
  });

  it("stops at the token budget and reports inconclusive", async () => {
    const turn: Step = {
      blocks: [{ type: "text", text: "thinking" }],
      stop_reason: "tool_use",
    };
    const { result } = run([[turn, turn, turn, turn]], { tokenBudget: 250 });
    const r = await result;
    expect(r.budgetExhausted).toBe(true);
    expect(r.usage.iterations).toBe(2);
    expect(r.verdicts).toHaveLength(1);
    expect(r.verdicts[0]?.verdict).toBe("inconclusive");
    expect(r.verdicts[0]?.confidence).toBe(0);
    expect(r.verdicts[0]?.summary).toContain("budget");
  });

  it("returns inconclusive on a refusal without a reminder", async () => {
    const { result, calls } = run([[{ blocks: [], stop_reason: "refusal" }]]);
    const r = await result;
    expect(r.stopReason).toBe("refusal");
    expect(r.verdicts[0]?.verdict).toBe("inconclusive");
    expect(r.verdicts[0]?.summary).toContain("refus");
    expect(calls).toHaveLength(1);
  });

  it("sends exactly one reminder, then falls back to inconclusive", async () => {
    const quiet: Step = {
      blocks: [{ type: "text", text: "I think it is fine." }],
    };
    const { result, calls } = run([[quiet], [quiet]]);
    const r = await result;
    expect(calls).toHaveLength(2);
    const reminder = calls[1]?.params;
    expect(reminder?.max_iterations).toBe(3);
    expect(JSON.stringify(reminder?.messages.at(-1))).toContain(
      "Call submit_verdict now.",
    );
    expect(r.verdicts[0]?.verdict).toBe("inconclusive");
    expect(r.usage.iterations).toBe(2);
  });

  it("accepts a verdict submitted during the reminder", async () => {
    const { result, calls } = run([
      [{ blocks: [{ type: "text", text: "hmm" }] }],
      [
        { blocks: [submit], stop_reason: "tool_use" },
        { blocks: [{ type: "text", text: "ok" }] },
      ],
    ]);
    const r = await result;
    expect(calls).toHaveLength(2);
    expect(r.verdicts).toHaveLength(1);
    expect(r.verdicts[0]?.verdict).toBe("malicious");
  });

  it("does not remind in hunt mode and accepts no findings from the model", async () => {
    const { result, calls } = run(
      [[{ blocks: [{ type: "text", text: "x" }] }]],
      { mode: "hunt" },
    );
    const r = await result;
    expect(calls).toHaveLength(1);
    expect(r.verdicts).toHaveLength(1);
  });
});
