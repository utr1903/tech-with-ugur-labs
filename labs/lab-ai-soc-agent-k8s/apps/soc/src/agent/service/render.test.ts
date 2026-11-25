import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./render.js";
import { proposal, report, verdict } from "./test-support.js";

describe("renderMarkdown", () => {
  const p1 = proposal("p1");
  const p2 = { ...proposal("p2"), kind: "rotate_secret" as const };
  const md = renderMarkdown(
    report("inv-1", {
      verdicts: [
        verdict({
          injection_suspected: true,
          injection_evidence: "ignore previous instructions",
        }),
      ],
      proposals: [p1, p2],
      outcomes: [
        { proposal: p1, status: "executed", reason: "done" },
        {
          proposal: p2,
          status: "pending_approval",
          reason: "needs human",
          approvalId: "ap-9",
        },
      ],
    }),
  );

  it("includes verdict, techniques, timeline, affected and usage", () => {
    expect(md).toContain("malicious");
    expect(md).toContain("0.9");
    expect(md).toContain("T1609");
    expect(md).toContain("Container Administration");
    expect(md).toContain("exec");
    expect(md).toContain("payments/api-1");
    expect(md).toContain("end_turn");
    expect(md).toContain("input_tokens");
  });

  it("flags injection with its evidence", () => {
    expect(md).toContain("Prompt injection suspected");
    expect(md).toContain("ignore previous instructions");
  });

  it("lists every proposal with its outcome", () => {
    expect(md).toContain("p1");
    expect(md).toContain("executed");
    expect(md).toContain("p2");
    expect(md).toContain("pending_approval");
    expect(md).toContain("ap-9");
  });

  it("keeps attacker text from breaking out of its fence", () => {
    const evil = renderMarkdown(
      report("inv-2", {
        verdicts: [
          verdict({
            timeline: [
              {
                time: "t",
                source: "app",
                event: "x\n```\n# Fake heading\n| a | b |",
              },
            ],
          }),
        ],
      }),
    );
    const lines = evil.split("\n");
    const heading = lines.indexOf("# Fake heading");
    expect(heading).toBeGreaterThan(-1);
    const fences = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /^`{3,}\w*$/.test(l));
    const timeline = lines.indexOf("### Timeline");
    const opener = fences.find(({ i }) => i > timeline);
    expect(opener?.l.startsWith("````")).toBe(true);
    const ticks = (opener?.l.match(/^`+/) ?? [""])[0];
    const closer = fences.find(({ l, i }) => i > heading && l === ticks);
    expect(closer).toBeDefined();
  });

  it("escapes markdown in inline strings", () => {
    const out = renderMarkdown(
      report("inv-3", {
        verdicts: [
          verdict({
            attack_techniques: [{ id: "T1609", name: "a|b\n# h" }],
          }),
        ],
      }),
    );
    expect(out).not.toMatch(/^# h$/m);
    expect(out).toContain("a\\|b");
  });
});
