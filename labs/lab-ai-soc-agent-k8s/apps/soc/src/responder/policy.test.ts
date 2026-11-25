import { describe, expect, it } from "vitest";
import type { ActionKind } from "../shared/actions.js";
import {
  makeProposal,
  makeRequest,
  makeVerdict,
  quarantine,
} from "./fixtures.js";
import { DEFAULT_POLICY, decide } from "./policy.js";

function only(req: ReturnType<typeof makeRequest>) {
  const [d] = decide(req, DEFAULT_POLICY);
  if (!d) throw new Error("no decision");
  return d;
}

describe("decide: auto-containment", () => {
  it("executes containment for a malicious verdict at 0.9", () => {
    const d = only(makeRequest([quarantine("p1", "storefront")]));
    expect(d.decision).toBe("execute");
  });

  it("executes at exactly the threshold", () => {
    const d = only(
      makeRequest([quarantine("p1", "storefront")], { confidence: 0.8 }),
    );
    expect(d.decision).toBe("execute");
  });

  it("queues at 0.79", () => {
    const d = only(
      makeRequest([quarantine("p1", "storefront")], { confidence: 0.79 }),
    );
    expect(d.decision).toBe("queue");
    expect(d.reason).toContain("below");
  });

  it("queues containment for a benign verdict", () => {
    const d = only(
      makeRequest([quarantine("p1", "storefront")], {
        verdict: "benign",
        confidence: 0.95,
      }),
    );
    expect(d.decision).toBe("queue");
    expect(d.reason).toBe("verdict not malicious");
  });

  it("queues containment for an inconclusive verdict", () => {
    const d = only(
      makeRequest([quarantine("p1", "storefront")], {
        verdict: "inconclusive",
        confidence: 0.99,
      }),
    );
    expect(d.decision).toBe("queue");
  });

  it("queues instead of auto-executing when injection is suspected", () => {
    const d = only(
      makeRequest([quarantine("p1", "storefront")], {
        injection_suspected: true,
      }),
    );
    expect(d.decision).toBe("queue");
    expect(d.reason).toContain("injection");
  });

  it("auto-executes scale_to_zero on a deployment", () => {
    const p = makeProposal("p1", "scale_to_zero", {
      namespace: "batch",
      name: "report",
      resource: "deployment",
    });
    expect(only(makeRequest([p])).decision).toBe("execute");
  });
});

describe("decide: destructive actions", () => {
  it("queues revoking a non-protected cluster role binding even when malicious", () => {
    const p = makeProposal("p1", "revoke_binding", {
      name: "node-agent-cluster-admin",
      resource: "clusterrolebinding",
    });
    const d = only(makeRequest([p], { confidence: 1 }));
    expect(d.decision).toBe("queue");
  });

  it("rejects revoking cluster-admin", () => {
    const p = makeProposal("p1", "revoke_binding", {
      name: "cluster-admin",
      resource: "clusterrolebinding",
    });
    const d = only(makeRequest([p]));
    expect(d.decision).toBe("reject");
    expect(d.reason).toContain("protected");
  });

  it("rejects revoking a system: binding", () => {
    const p = makeProposal("p1", "revoke_binding", {
      name: "system:node",
      resource: "clusterrolebinding",
    });
    expect(only(makeRequest([p])).decision).toBe("reject");
  });

  it("rejects revoking a kubeadm: binding", () => {
    const p = makeProposal("p1", "revoke_binding", {
      name: "kubeadm:get-nodes",
      resource: "clusterrolebinding",
    });
    expect(only(makeRequest([p])).decision).toBe("reject");
  });

  it("queues rotating a secret in a tenant namespace", () => {
    const p = makeProposal("p1", "rotate_secret", {
      namespace: "payments",
      name: "db",
    });
    expect(only(makeRequest([p])).decision).toBe("queue");
  });

  it("rejects rotating a secret in kube-system", () => {
    const p = makeProposal("p1", "rotate_secret", {
      namespace: "kube-system",
      name: "x",
    });
    const d = only(makeRequest([p]));
    expect(d.decision).toBe("reject");
    expect(d.reason).toContain("namespace");
  });
});

describe("decide: denied namespaces", () => {
  it.each([
    "kube-system",
    "kube-public",
    "kube-node-lease",
    "soc",
    "observability",
    "local-path-storage",
  ])("rejects quarantine in %s", (ns) => {
    expect(only(makeRequest([quarantine("p1", ns)])).decision).toBe("reject");
  });

  it("rejects a rolebinding revoke inside a denied namespace", () => {
    const p = makeProposal("p1", "revoke_binding", {
      namespace: "soc",
      name: "anything",
      resource: "rolebinding",
    });
    expect(only(makeRequest([p])).decision).toBe("reject");
  });
});

describe("decide: target shape", () => {
  it("rejects scale_to_zero on a clusterrolebinding resource", () => {
    const p = makeProposal("p1", "scale_to_zero", {
      namespace: "batch",
      name: "x",
      resource: "clusterrolebinding",
    });
    const d = only(makeRequest([p]));
    expect(d.decision).toBe("reject");
    expect(d.reason).toContain("invalid target");
  });

  it("rejects quarantine_pod without a namespace", () => {
    const p = makeProposal("p1", "quarantine_pod", { name: "pod-a" });
    expect(only(makeRequest([p])).reason).toContain("invalid target");
  });

  it("rejects a clusterrolebinding that carries a namespace", () => {
    const p = makeProposal("p1", "revoke_binding", {
      namespace: "storefront",
      name: "x",
      resource: "clusterrolebinding",
    });
    expect(only(makeRequest([p])).decision).toBe("reject");
  });

  it("rejects a rolebinding without a namespace", () => {
    const p = makeProposal("p1", "revoke_binding", {
      name: "x",
      resource: "rolebinding",
    });
    expect(only(makeRequest([p])).decision).toBe("reject");
  });

  it("rejects names that are not valid Kubernetes names", () => {
    expect(
      only(makeRequest([quarantine("p1", "storefront", "../etc")])).decision,
    ).toBe("reject");
    expect(
      only(makeRequest([quarantine("p1", "storefront", "UPPER")])).decision,
    ).toBe("reject");
  });

  it("rejects an unknown kind", () => {
    const p = makeProposal("p1", "delete_pod" as ActionKind, {
      namespace: "storefront",
      name: "pod-a",
    });
    const d = only(makeRequest([p]));
    expect(d.decision).toBe("reject");
    expect(d.reason).toContain("unknown kind");
  });
});

describe("decide: verdict linkage and limit", () => {
  it("rejects a proposal whose id is not in its verdict's proposal_ids", () => {
    const req = makeRequest([quarantine("p1", "storefront")]);
    const [item] = req.items;
    if (!item) throw new Error("no item");
    item.verdict = makeVerdict({ proposal_ids: ["other"] });
    const d = only(req);
    expect(d.decision).toBe("reject");
    expect(d.reason).toContain("not linked to a verdict");
  });

  it("rejects the 6th proposal with an action limit reason", () => {
    const ps = Array.from({ length: 6 }, (_, i) =>
      quarantine(`p${i}`, "storefront", `pod-${i}`),
    );
    const ds = decide(makeRequest(ps), DEFAULT_POLICY);
    expect(ds.slice(0, 5).every((d) => d.decision === "execute")).toBe(true);
    expect(ds[5]?.decision).toBe("reject");
    expect(ds[5]?.reason).toContain("action limit");
  });

  it("counts proposals across items in request order", () => {
    const mk = (id: string) => quarantine(id, "storefront", id);
    const a = ["a1", "a2", "a3"].map(mk);
    const b = ["b1", "b2", "b3"].map(mk);
    const ds = decide(
      {
        investigationId: "inv",
        items: [
          {
            verdict: makeVerdict({ proposal_ids: a.map((p) => p.id) }),
            proposals: a,
          },
          {
            verdict: makeVerdict({ proposal_ids: b.map((p) => p.id) }),
            proposals: b,
          },
        ],
      },
      DEFAULT_POLICY,
    );
    expect(ds.map((d) => d.decision)).toEqual([
      "execute",
      "execute",
      "execute",
      "execute",
      "execute",
      "reject",
    ]);
  });

  it("checks the denied namespace before the action limit", () => {
    const ps = [
      ...Array.from({ length: 5 }, (_, i) =>
        quarantine(`p${i}`, "storefront", `p${i}`),
      ),
      quarantine("p5", "soc"),
    ];
    const d = decide(makeRequest(ps), DEFAULT_POLICY)[5];
    expect(d?.reason).toContain("namespace");
  });
});
