import { beforeEach, describe, expect, it } from "vitest";
import type { ActionKind, ActionProposal } from "../shared/actions.js";
import { makeProposal, makeRequest, quarantine } from "./fixtures.js";
import { A, type Harness, R, setup } from "./route-harness.js";

describe("authentication", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });

  it("serves /healthz without a token", async () => {
    expect((await h.get("/healthz")).status).toBe(200);
  });

  it.each([
    ["POST", "/actions"],
    ["GET", "/approvals"],
    ["POST", "/approvals/x/approve"],
    ["POST", "/approvals/x/deny"],
    ["GET", "/audit"],
    ["GET", "/secrets/payments"],
    ["GET", "/secrets/payments/db"],
  ])("returns 401 for %s %s without a token", async (method, path) => {
    const res = await h.app.request(path, { method });
    expect(res.status).toBe(401);
  });

  it("does not let the responder token reach admin routes", async () => {
    expect((await h.get("/approvals", R)).status).toBe(401);
    expect((await h.get("/audit", R)).status).toBe(401);
  });

  it("does not let the admin token reach agent routes", async () => {
    expect((await h.post("/actions", A, makeRequest([]))).status).toBe(401);
    expect((await h.get("/secrets/payments", A)).status).toBe(401);
  });
});

describe("POST /actions", () => {
  it("executes, queues and rejects in one request and audits each step", async () => {
    const h = await setup();
    const body = makeRequest([
      quarantine("p-exec", "storefront", "web-1"),
      makeProposal("p-queue", "rotate_secret", {
        namespace: "payments",
        name: "db",
      }),
      quarantine("p-reject", "soc", "x"),
    ]);
    const res = await h.post("/actions", R, body);
    expect(res.status).toBe(200);
    const { outcomes } = (await res.json()) as {
      outcomes: {
        proposal: { id: string };
        status: string;
        approvalId?: string;
      }[];
    };
    expect(outcomes.map((o) => [o.proposal.id, o.status])).toEqual([
      ["p-exec", "executed"],
      ["p-queue", "pending_approval"],
      ["p-reject", "rejected"],
    ]);
    expect(outcomes[1]?.approvalId).toBeDefined();
    expect(h.executed.map((p) => p.id)).toEqual(["p-exec"]);

    const pending = await h.approvals.list();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.proposal.id).toBe("p-queue");

    const audit = await h.audit.read();
    const decisions = audit.filter((e) => e.event === "proposal_decision");
    expect(decisions.map((e) => e.decision)).toEqual([
      "execute",
      "queue",
      "reject",
    ]);
    expect(audit.filter((e) => e.event === "execution_result")).toHaveLength(1);
  });

  it("reports a failed outcome instead of throwing when execution fails", async () => {
    const h = await setup();
    h.failNext();
    const res = await h.post(
      "/actions",
      R,
      makeRequest([quarantine("p1", "storefront")]),
    );
    expect(res.status).toBe(200);
    const { outcomes } = (await res.json()) as {
      outcomes: { status: string; reason: string }[];
    };
    expect(outcomes[0]?.status).toBe("failed");
    const audit = await h.audit.read();
    expect(audit.find((e) => e.event === "execution_result")?.status).toBe(
      "failed",
    );
  });

  it("rejects an unknown kind per proposal rather than failing the request", async () => {
    const h = await setup();
    const body = makeRequest([
      {
        id: "p1",
        kind: "delete_pod" as ActionKind,
        target: { namespace: "storefront", name: "x" },
        reason: "r",
      } as ActionProposal,
    ]);
    const res = await h.post("/actions", R, body);
    expect(res.status).toBe(200);
    const { outcomes } = (await res.json()) as {
      outcomes: { status: string }[];
    };
    expect(outcomes[0]?.status).toBe("rejected");
  });

  it("returns 400 for a malformed body and audits nothing", async () => {
    const h = await setup();
    expect((await h.post("/actions", R, { nope: true })).status).toBe(400);
    expect(await h.audit.read()).toEqual([]);
  });
});

describe("GET /audit and /secrets", () => {
  it("returns the audit entries to the admin", async () => {
    const h = await setup();
    await h.post("/actions", R, makeRequest([quarantine("p1", "soc")]));
    const body = (await (await h.get("/audit", A)).json()) as {
      entries: unknown[];
    };
    expect(body.entries).toHaveLength(1);
  });

  it("lists secret metadata without values", async () => {
    const h = await setup();
    h.cluster.secrets.set("payments/db", {
      metadata: { name: "db", namespace: "payments" },
      type: "Opaque",
      data: { password: "TEFCLUZBS0U=" },
    });
    const text = await (await h.get("/secrets/payments", R)).text();
    expect(JSON.parse(text)).toMatchObject([
      { name: "db", keys: ["password"] },
    ]);
    expect(text).not.toContain("TEFCLUZBS0U=");
    const one = await h.get("/secrets/payments/db", R);
    expect(((await one.json()) as unknown[]).length).toBe(1);
    expect((await h.get("/secrets/payments/missing", R)).status).toBe(404);
  });

  it("rejects malformed namespace or name segments", async () => {
    const h = await setup();
    expect((await h.get("/secrets/UPPER", R)).status).toBe(400);
  });
});
