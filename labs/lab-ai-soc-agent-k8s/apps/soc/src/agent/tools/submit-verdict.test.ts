import { describe, expect, it } from "vitest";
import { buildSubmitVerdict } from "./submit-verdict.js";
import { asText, makeDeps, makeState } from "./test-support.js";

const verdict = {
  verdict: "malicious" as const,
  confidence: 0.9,
  summary: "Token theft followed by secret access.",
  attack_techniques: [{ id: "T1552.007", name: "Container API" }],
  timeline: [],
  affected: [],
  injection_suspected: false,
  proposal_ids: [] as string[],
};

describe("submit_verdict", () => {
  it("accepts the first verdict and stores it", async () => {
    const state = makeState();
    const tool = buildSubmitVerdict(makeDeps(), state);
    expect(JSON.parse(asText(await tool.run(verdict)))).toEqual({
      accepted: true,
    });
    expect(state.verdicts).toHaveLength(1);
  });

  it("second verdict in investigate mode is an error result", async () => {
    const state = makeState("investigate");
    const tool = buildSubmitVerdict(makeDeps(), state);
    await tool.run(verdict);
    const out = JSON.parse(asText(await tool.run(verdict)));
    expect(out.error.code).toBe("verdict_limit");
    expect(state.verdicts).toHaveLength(1);
  });

  it("hunt mode accepts up to 10 verdicts", async () => {
    const state = makeState("hunt");
    const tool = buildSubmitVerdict(makeDeps(), state);
    for (let i = 0; i < 10; i++) await tool.run(verdict);
    expect(state.verdicts).toHaveLength(10);
    const out = JSON.parse(asText(await tool.run(verdict)));
    expect(out.error.code).toBe("verdict_limit");
  });

  it("rejects proposal ids that were never recorded", async () => {
    const state = makeState();
    const tool = buildSubmitVerdict(makeDeps(), state);
    const out = JSON.parse(
      asText(await tool.run({ ...verdict, proposal_ids: ["p9"] })),
    );
    expect(out.error.code).toBe("unknown_proposal");
    expect(state.verdicts).toHaveLength(0);
  });
});
