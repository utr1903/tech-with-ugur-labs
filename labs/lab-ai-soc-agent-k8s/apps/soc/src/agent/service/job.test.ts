import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ActionRequest } from "../../shared/actions.js";
import { runJob } from "./job.js";
import { createReportStore } from "./reports.js";
import {
  alert,
  logger,
  loopResult,
  proposal,
  verdict,
} from "./test-support.js";

async function setup(
  run: Parameters<typeof runJob>[0]["run"],
  send?: (r: ActionRequest) => Promise<never>,
) {
  const store = createReportStore(await mkdtemp(join(tmpdir(), "soc-job-")));
  const sent: ActionRequest[] = [];
  const deps = {
    logger,
    run,
    store,
    now: () => new Date("2026-11-25T12:00:00Z"),
    responder: {
      send: async (r: ActionRequest) => {
        sent.push(r);
        if (send) return send(r);
        return r.items.flatMap((i) =>
          i.proposals.map((p) => ({
            proposal: p,
            status: i.verdict.proposal_ids.includes(p.id)
              ? ("executed" as const)
              : ("rejected" as const),
            reason: "r",
          })),
        );
      },
    },
  };
  const go = (mode: "investigate" | "hunt", id = "inv-20261125T120000-aaaa") =>
    runJob(deps, { id, mode, alerts: [alert("a")] });
  return { go, store, sent };
}

describe("runJob", () => {
  it("investigate: the single verdict covers every proposal", async () => {
    const { go, store, sent } = await setup(async () =>
      loopResult({ proposals: [proposal("p1"), proposal("p2")] }),
    );
    await go("investigate");
    expect(sent[0]?.items).toHaveLength(1);
    expect(sent[0]?.items[0]?.verdict.proposal_ids).toEqual(["p1", "p2"]);
    expect(sent[0]?.items[0]?.proposals).toHaveLength(2);
    const saved = await store.get("inv-20261125T120000-aaaa");
    expect(saved?.outcomes.map((o) => o.status)).toEqual([
      "executed",
      "executed",
    ]);
    expect(saved?.model).toBe("claude-opus-5-5");
  });

  it("hunt: unlinked proposals ride with the first verdict, unlinked", async () => {
    const { go, store, sent } = await setup(async () =>
      loopResult({
        verdicts: [
          verdict({ proposal_ids: ["p1"] }),
          verdict({ proposal_ids: ["p2"] }),
        ],
        proposals: [proposal("p1"), proposal("p2"), proposal("p3")],
      }),
    );
    await go("hunt", "hunt-20261125T120000-bbbb");
    const items = sent[0]?.items ?? [];
    expect(items[0]?.proposals.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(items[0]?.verdict.proposal_ids).toEqual(["p1"]);
    expect(items[1]?.proposals.map((p) => p.id)).toEqual(["p2"]);
    const saved = await store.get("hunt-20261125T120000-bbbb");
    expect(saved?.outcomes.find((o) => o.proposal.id === "p3")?.status).toBe(
      "rejected",
    );
  });

  it("passes 10 proposals through to the responder intact", async () => {
    const ps = Array.from({ length: 10 }, (_, n) => proposal(`p${n + 1}`));
    const { go, sent } = await setup(async () => loopResult({ proposals: ps }));
    await go("investigate");
    expect(sent[0]?.items[0]?.verdict.proposal_ids).toHaveLength(10);
    expect(sent[0]?.items[0]?.proposals).toEqual(ps);
  });

  it("sends nothing when there are no verdicts", async () => {
    const { go, store, sent } = await setup(async () =>
      loopResult({ verdicts: [] }),
    );
    await go("hunt", "hunt-20261125T120000-cccc");
    expect(sent).toHaveLength(0);
    expect((await store.get("hunt-20261125T120000-cccc"))?.outcomes).toEqual(
      [],
    );
  });

  it("marks outcomes failed when the responder is unreachable", async () => {
    const { go, store } = await setup(
      async () => loopResult({ proposals: [proposal("p1")] }),
      async () => {
        throw new Error("connect ECONNREFUSED");
      },
    );
    await go("investigate");
    const saved = await store.get("inv-20261125T120000-aaaa");
    expect(saved?.outcomes[0]?.status).toBe("failed");
    expect(saved?.outcomes[0]?.reason).toContain("ECONNREFUSED");
  });

  it("saves an inconclusive error report when the loop throws", async () => {
    const { go, store, sent } = await setup(async () => {
      throw new TypeError(`bad ${"x".repeat(900)}`);
    });
    await go("investigate");
    const saved = await store.get("inv-20261125T120000-aaaa");
    expect(saved?.stopReason).toBe("error");
    expect(saved?.verdicts).toHaveLength(1);
    expect(saved?.verdicts[0]?.verdict).toBe("inconclusive");
    expect(saved?.verdicts[0]?.summary).toContain("TypeError");
    expect(saved?.verdicts[0]?.summary.length).toBeLessThanOrEqual(500);
    expect(saved?.usage.input_tokens).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
