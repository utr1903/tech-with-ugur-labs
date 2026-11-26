import { describe, expect, it } from "vitest";
import { makeDeps } from "../tools/test-support.js";
import {
  type Block,
  fakeFactory,
  historyProblems,
  type Step,
} from "./fake-runner.js";
import { runInvestigation } from "./investigate.js";

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

function run(
  scripts: Step[][],
  extra: {
    tokenBudget?: number;
    mode?: "investigate" | "hunt";
    maxIterations?: number;
  } = {},
) {
  const { factory, calls } = fakeFactory(scripts);
  const result = runInvestigation(
    { mode: extra.mode ?? "investigate", alerts: [] },
    {
      ...makeDeps(),
      createRunner: factory,
      tokenBudget: extra.tokenBudget ?? 400000,
      maxIterations: extra.maxIterations ?? 25,
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

const ctx: Block = {
  type: "tool_use",
  id: "c1",
  name: "get_alert_context",
  input: {},
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
    expect(p.cache_control).toEqual({ type: "ephemeral" });
  });

  it("does not count cache reads against the budget", async () => {
    const turn: Step = {
      blocks: [ctx],
      stop_reason: "tool_use",
      usage: { cache_read_input_tokens: 1000000 },
    };
    const { result } = run([[turn, { blocks: [submit] }]], {
      tokenBudget: 400,
    });
    expect((await result).budgetExhausted).toBe(false);
  });

  it("counts cache writes against the budget", async () => {
    const turn: Step = {
      blocks: [ctx],
      stop_reason: "tool_use",
      usage: { cache_creation_input_tokens: 500 },
    };
    const { result } = run([[turn, turn, turn]], { tokenBudget: 250 });
    expect((await result).budgetExhausted).toBe(true);
  });

  it("stops at the token budget and reports inconclusive", async () => {
    const turn: Step = { blocks: [ctx], stop_reason: "tool_use" };
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

  it("counts a verdict submitted on the turn that crosses the budget", async () => {
    const { result, calls } = run(
      [[{ blocks: [submit], stop_reason: "tool_use" }, { blocks: [ctx] }]],
      { tokenBudget: 100 },
    );
    const r = await result;
    expect(r.budgetExhausted).toBe(true);
    expect(r.usage.iterations).toBe(1);
    expect(r.verdicts).toHaveLength(1);
    expect(r.verdicts[0]?.verdict).toBe("malicious");
    expect(calls).toHaveLength(1);
  });

  it("sends one valid reminder after a max_iterations stop", async () => {
    const useCtx = (id: string): Step => ({
      blocks: [{ ...ctx, id }],
      stop_reason: "tool_use",
    });
    const { result, calls } = run(
      [
        [useCtx("a"), useCtx("b"), useCtx("c"), useCtx("d")],
        [{ blocks: [{ type: "text", text: "still nothing" }] }],
      ],
      { maxIterations: 2 },
    );
    const r = await result;
    expect(calls).toHaveLength(2);
    const sent = calls[1]?.params.messages ?? [];
    expect(historyProblems(sent)).toEqual([]);
    expect(sent.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(JSON.stringify(sent.at(-1))).toContain("Call submit_verdict now.");
    expect(r.verdicts[0]?.verdict).toBe("inconclusive");
  });

  it("skips the reminder when the history ends in an unanswered tool_use", async () => {
    const cut: Step = { blocks: [ctx], stop_reason: "max_tokens" };
    const { result, calls } = run([[cut]]);
    const r = await result;
    expect(calls).toHaveLength(1);
    expect(r.verdicts[0]?.verdict).toBe("inconclusive");
  });
});
