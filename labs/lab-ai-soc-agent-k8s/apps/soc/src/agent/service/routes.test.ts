import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RunInput } from "../loop/investigate.js";
import { createDeduper } from "./dedupe.js";
import { createQueue } from "./queue.js";
import { createReportStore } from "./reports.js";
import { createApp } from "./routes.js";
import { logger, loopResult } from "./test-support.js";

const AUTH = { authorization: "Bearer agent-token" };
const hook = (...fps: string[]) => ({
  version: "4",
  status: "firing",
  alerts: fps.map((fingerprint) => ({
    status: "firing",
    labels: { alertname: "PodExec" },
    annotations: {},
    startsAt: "2026-11-25T12:00:00Z",
    fingerprint,
  })),
});

async function setup() {
  const store = createReportStore(await mkdtemp(join(tmpdir(), "soc-app-")));
  const inputs: RunInput[] = [];
  const queue = createQueue();
  const app = createApp({
    logger,
    agentToken: "agent-token",
    queue,
    store,
    deduper: createDeduper(60_000, () => Date.now()),
    now: () => new Date(),
    run: async (input) => {
      inputs.push(input);
      return loopResult();
    },
    responder: { send: async () => [] },
  });
  const post = (path: string, body?: unknown, headers: object = AUTH) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body ?? {}),
    });
  return { app, post, inputs, queue };
}

describe("agent routes", () => {
  it("requires the bearer token except on /healthz", async () => {
    const { app, post } = await setup();
    expect((await post("/investigate", hook("a"), {})).status).toBe(401);
    expect((await post("/hunt", {}, {})).status).toBe(401);
    expect((await app.request("/reports")).status).toBe(401);
    expect((await app.request("/reports/inv-x")).status).toBe(401);
    const h = await app.request("/healthz");
    expect(h.status).toBe(200);
    expect(await h.json()).toEqual({ ok: true, queue: 0 });
  });

  it("rejects malformed webhooks with 400", async () => {
    const { post } = await setup();
    expect((await post("/investigate", { nope: 1 })).status).toBe(400);
  });

  it("accepts new alerts, then skips the same fingerprints", async () => {
    const { app, post, inputs } = await setup();
    const res = await post("/investigate", hook("a"));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { accepted: boolean; reportId: string };
    expect(body.accepted).toBe(true);
    await vi.waitFor(async () => {
      const r = await app.request(`/reports/${body.reportId}`, {
        headers: AUTH,
      });
      expect(r.status).toBe(200);
    });
    expect(inputs[0]?.mode).toBe("investigate");

    const again = await post("/investigate", hook("a"));
    expect(again.status).toBe(202);
    expect(await again.json()).toEqual({
      accepted: false,
      skipped: "no new alerts",
    });
    expect(inputs).toHaveLength(1);
  });

  it("links a partly-new batch to the earlier report", async () => {
    const { post, inputs, queue } = await setup();
    const first = (await (await post("/investigate", hook("a"))).json()) as {
      reportId: string;
    };
    await post("/investigate", hook("a", "b"));
    await vi.waitFor(() => expect(queue.size()).toBe(0));
    expect(inputs[1]?.relatedTo).toBe(first.reportId);
    expect(inputs[1]?.alerts.map((a) => a.fingerprint)).toEqual(["b"]);
  });

  it("hunt returns an id that later resolves, as json and markdown", async () => {
    const { app, post, inputs } = await setup();
    const res = await post("/hunt", {});
    expect(res.status).toBe(202);
    const { reportId } = (await res.json()) as { reportId: string };
    expect(reportId).toMatch(/^hunt-/);
    await vi.waitFor(async () => {
      const r = await app.request(`/reports/${reportId}`, { headers: AUTH });
      expect(r.status).toBe(200);
      expect(((await r.json()) as { id: string }).id).toBe(reportId);
    });
    expect(inputs[0]).toMatchObject({ mode: "hunt", alerts: [] });
    const md = await app.request(`/reports/${reportId}?format=md`, {
      headers: AUTH,
    });
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(await md.text()).toContain(reportId);
    const list = (await (
      await app.request("/reports", { headers: AUTH })
    ).json()) as { reports: { id: string }[] };
    expect(list.reports.map((r) => r.id)).toContain(reportId);
  });

  it("404s on an unknown report", async () => {
    const { app } = await setup();
    const r = await app.request("/reports/inv-20261125T120000-ffff", {
      headers: AUTH,
    });
    expect(r.status).toBe(404);
  });
});
