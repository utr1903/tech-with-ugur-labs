import { describe, expect, it } from "vitest";
import { buildProposalTools } from "./proposals.js";
import { asText, descriptionOf, makeDeps, makeState } from "./test-support.js";

function tools() {
  const state = makeState();
  const list = buildProposalTools(makeDeps(), state);
  const by = (name: string) => {
    const t = list.find((x) => x.name === name);
    if (!t) throw new Error(name);
    return t;
  };
  return { state, by, list };
}

describe("proposal tools", () => {
  it("exposes the four response tools in order", () => {
    expect(tools().list.map((t) => t.name)).toEqual([
      "quarantine_pod",
      "scale_to_zero",
      "revoke_binding",
      "rotate_secret",
    ]);
  });

  it("ids are sequential and proposals are stored", async () => {
    const { state, by } = tools();
    const first = JSON.parse(
      asText(
        await by("quarantine_pod").run({
          namespace: "storefront",
          name: "web-1",
          reason: "beaconing to unknown host",
        }),
      ),
    );
    const second = JSON.parse(
      asText(
        await by("scale_to_zero").run({
          namespace: "batch",
          name: "etl",
          resource: "deployment",
          reason: "exfiltration in progress",
        }),
      ),
    );
    expect(first.proposal_id).toBe("p1");
    expect(second.proposal_id).toBe("p2");
    expect(first.note).toBe(
      "Recorded. Nothing executes until you submit the verdict; the responder applies policy.",
    );
    expect(state.proposals).toEqual([
      {
        id: "p1",
        kind: "quarantine_pod",
        target: { namespace: "storefront", name: "web-1" },
        reason: "beaconing to unknown host",
      },
      {
        id: "p2",
        kind: "scale_to_zero",
        target: { namespace: "batch", name: "etl", resource: "deployment" },
        reason: "exfiltration in progress",
      },
    ]);
  });

  it("requires a namespace except for cluster role bindings", async () => {
    const { state, by } = tools();
    const bad = JSON.parse(
      asText(
        await by("revoke_binding").run({
          name: "x",
          resource: "rolebinding",
          reason: "grants admin to ci",
        }),
      ),
    );
    expect(bad.error.code).toBe("namespace_required");
    const ok = JSON.parse(
      asText(
        await by("revoke_binding").run({
          name: "x",
          resource: "clusterrolebinding",
          reason: "grants cluster-admin",
        }),
      ),
    );
    expect(ok.proposal_id).toBe("p1");
    expect(state.proposals).toHaveLength(1);
  });

  it("tells the model the rules in every description", () => {
    for (const t of tools().list) {
      expect(descriptionOf(t)).toContain("Use for:");
      expect(descriptionOf(t)).toContain("Do NOT use for:");
      expect(descriptionOf(t)).toContain("Nothing executes now");
      expect(descriptionOf(t)).toContain("kube-system");
    }
    const byName = Object.fromEntries(
      tools().list.map((t) => [t.name, descriptionOf(t)]),
    );
    expect(byName.revoke_binding).toContain("always needs a human");
    expect(byName.rotate_secret).toContain("always needs a human");
  });

  it("rejects the 11th proposal and records nothing", async () => {
    const { state, by } = tools();
    for (let n = 1; n <= 10; n++) {
      await by("quarantine_pod").run({
        namespace: "storefront",
        name: `web-${n}`,
        reason: "beaconing to unknown host",
      });
    }
    const out = JSON.parse(
      asText(
        await by("quarantine_pod").run({
          namespace: "storefront",
          name: "web-11",
          reason: "beaconing to unknown host",
        }),
      ),
    );
    expect(out.error.code).toBe("proposal_limit");
    expect(out.error.message).toContain("At most 10 proposals");
    expect(state.proposals).toHaveLength(10);
  });

  it("mentions the limit in every description", () => {
    for (const t of tools().list)
      expect(descriptionOf(t)).toContain("10 proposals");
  });
});
