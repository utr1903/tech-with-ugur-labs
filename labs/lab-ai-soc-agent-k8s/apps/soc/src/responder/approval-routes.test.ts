import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import type { ActionProposal } from "../shared/actions.js";
import { createApprovalStore } from "./approvals.js";
import { createAuditTrail } from "./audit-trail.js";
import { createFakeCluster } from "./fake-apis.js";
import { makeProposal, makeRequest } from "./fixtures.js";
import { DEFAULT_POLICY } from "./policy.js";
import { A, type Harness, R, setup } from "./route-harness.js";
import { createApp } from "./routes.js";
import { createSecretReader } from "./secret-metadata.js";

describe("approvals", () => {
  async function queued(h: Harness, p: ActionProposal): Promise<string> {
    const res = await h.post("/actions", R, makeRequest([p]));
    const { outcomes } = (await res.json()) as {
      outcomes: { approvalId?: string }[];
    };
    const id = outcomes[0]?.approvalId;
    if (!id) throw new Error("not queued");
    return id;
  }
  const rotate = makeProposal("p1", "rotate_secret", {
    namespace: "payments",
    name: "db",
  });

  it("lists pending approvals for the admin", async () => {
    const h = await setup();
    await queued(h, rotate);
    const res = await h.get("/approvals", A);
    const list = (await res.json()) as { approvals: { state: string }[] };
    expect(list.approvals.map((a) => a.state)).toEqual(["pending"]);
  });

  it("approve executes the action and audits it", async () => {
    const h = await setup();
    const id = await queued(h, rotate);
    const res = await h.post(`/approvals/${id}/approve`, A);
    expect(res.status).toBe(200);
    expect(h.executed.map((p) => p.id)).toEqual(["p1"]);
    const events = (await h.audit.read()).map((e) => e.event);
    expect(events).toContain("approval_resolved");
    expect(events.filter((e) => e === "execution_result")).toHaveLength(1);
    expect((await h.approvals.list())[0]?.state).toBe("approved");
  });

  it("approve reports failed when execution fails", async () => {
    const h = await setup();
    const id = await queued(h, rotate);
    h.failNext();
    const body = (await (
      await h.post(`/approvals/${id}/approve`, A)
    ).json()) as {
      outcome: { status: string };
    };
    expect(body.outcome.status).toBe("failed");
  });

  it("deny audits only and never executes", async () => {
    const h = await setup();
    const id = await queued(h, rotate);
    const res = await h.post(`/approvals/${id}/deny`, A);
    expect(res.status).toBe(200);
    expect(h.executed).toEqual([]);
    const audit = await h.audit.read();
    expect(
      audit.some(
        (e) => e.event === "approval_resolved" && e.state === "denied",
      ),
    ).toBe(true);
    expect(audit.some((e) => e.event === "execution_result")).toBe(false);
  });

  it("returns 404 for an unknown id and 409 for a second resolve", async () => {
    const h = await setup();
    expect((await h.post("/approvals/nope/approve", A)).status).toBe(404);
    const id = await queued(h, rotate);
    await h.post(`/approvals/${id}/deny`, A);
    expect((await h.post(`/approvals/${id}/approve`, A)).status).toBe(409);
    expect(h.executed).toEqual([]);
  });

  it("re-checks protected targets at approve time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "soc-recheck-"));
    const approvals = createApprovalStore(join(dir, "approvals.json"));
    const stale = await approvals.add(
      "inv-old",
      makeProposal("p1", "rotate_secret", {
        namespace: "kube-system",
        name: "x",
      }),
    );
    const executed: ActionProposal[] = [];
    const app = createApp({
      logger: createLogger({ appName: "routes-test" }),
      policy: DEFAULT_POLICY,
      executor: { execute: async (p) => void executed.push(p) },
      approvals,
      audit: createAuditTrail(join(dir, "audit.jsonl")),
      secrets: createSecretReader(createFakeCluster().apis.core),
      responderToken: "responder-token",
      adminToken: "admin-token",
    });
    const res = await app.request(`/approvals/${stale.id}/approve`, {
      method: "POST",
      headers: { authorization: A },
    });
    const body = (await res.json()) as { outcome: { status: string } };
    expect(body.outcome.status).toBe("rejected");
    expect(executed).toEqual([]);
  });

  it("re-checks a revoke_binding of a protected binding at approve time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "soc-recheck2-"));
    const approvals = createApprovalStore(join(dir, "approvals.json"));
    const stale = await approvals.add(
      "inv-old",
      makeProposal("p1", "revoke_binding", {
        name: "cluster-admin",
        resource: "clusterrolebinding",
      }),
    );
    const executed: ActionProposal[] = [];
    const app = createApp({
      logger: createLogger({ appName: "routes-test" }),
      policy: DEFAULT_POLICY,
      executor: { execute: async (p) => void executed.push(p) },
      approvals,
      audit: createAuditTrail(join(dir, "audit.jsonl")),
      secrets: createSecretReader(createFakeCluster().apis.core),
      responderToken: "responder-token",
      adminToken: "admin-token",
    });
    await app.request(`/approvals/${stale.id}/approve`, {
      method: "POST",
      headers: { authorization: A },
    });
    expect(executed).toEqual([]);
  });
});
