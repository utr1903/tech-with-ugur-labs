import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requireAuth } from "../auth/middleware.js";
import { signSession } from "../auth/tokens.js";
import { createLogger } from "../logger.js";
import { fleetRoutes } from "./routes.js";
import { FleetStore } from "./store.js";

const secret = "not-a-real-secret-only-for-tests";
const logger = createLogger({ appName: "test" });

async function client() {
  const app = new Hono();
  app.use("/api/*", requireAuth(secret));
  app.route("/api", fleetRoutes(new FleetStore(), logger));
  const token = await signSession(
    { id: "u-rosa", name: "Rosa Iglesias" },
    secret,
  );
  return {
    app,
    auth: { Authorization: `Bearer ${token}` },
  };
}

const body = {
  component: "Inverter",
  componentRef: "String 3 inverter",
  workDate: "2026-09-09",
  durationHours: 2,
  summary: "Replaced the string 3 inverter fan.",
  followUpRequired: true,
  followUpNote: "Panel 14 still shows a hotspot.",
};

describe("fleet routes", () => {
  it("requires a session for the site list", async () => {
    const { app } = await client();
    expect((await app.request("/api/sites")).status).toBe(401);
  });

  it("lists sites for a signed-in engineer", async () => {
    const { app, auth } = await client();
    const res = await app.request("/api/sites", { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(4);
  });

  it("404s an unknown site", async () => {
    const { app, auth } = await client();
    expect(
      (await app.request("/api/sites/nope", { headers: auth })).status,
    ).toBe(404);
  });

  it("files a report and reads it back", async () => {
    const { app, auth } = await client();
    const created = await app.request("/api/sites/almeria-roof/reports", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(created.status).toBe(201);

    const listed = await app.request("/api/reports", { headers: auth });
    const reports = (await listed.json()) as {
      siteId: string;
      followUpNote: string;
    }[];
    expect(reports).toHaveLength(1);
    expect(reports[0]?.siteId).toBe("almeria-roof");
    expect(reports[0]?.followUpNote).toBe("Panel 14 still shows a hotspot.");
  });

  it("rejects a malformed report", async () => {
    const { app, auth } = await client();
    const res = await app.request("/api/sites/almeria-roof/reports", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ...body, component: "Teleporter" }),
    });
    expect(res.status).toBe(400);
  });
});
