import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requireAuth } from "./middleware.js";
import { type SessionUser, signSession } from "./tokens.js";

const secret = "not-a-real-secret-only-for-tests";

function appUnderTest() {
  const app = new Hono();
  app.use("/private/*", requireAuth(secret));
  app.get("/private/who", (c) => c.json(c.get("user") as SessionUser));
  return app;
}

describe("requireAuth", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await appUnderTest().request("/private/who");
    expect(res.status).toBe(401);
  });

  it("rejects a bad token", async () => {
    const res = await appUnderTest().request("/private/who", {
      headers: { Authorization: "Bearer nonsense" },
    });
    expect(res.status).toBe(401);
  });

  it("passes a good token through and exposes the user", async () => {
    const token = await signSession(
      { id: "u-1", name: "Rosa Iglesias" },
      secret,
    );
    const res = await appUnderTest().request("/private/who", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "u-1", name: "Rosa Iglesias" });
  });
});
