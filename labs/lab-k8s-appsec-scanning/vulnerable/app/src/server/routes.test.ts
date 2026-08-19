import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { registerRoutes } from "./routes.js";

function testApp(query: (sql: string) => Promise<{ rows: unknown[] }>) {
  const app = express();
  registerRoutes(app, {
    pool: { query } as never,
    logger: createLogger({ appName: "test" }),
  });
  return app;
}

describe("routes", () => {
  it("returns search results (SQLi surface)", async () => {
    const app = testApp(async () => ({
      rows: [{ full_name: "Alice", email: "a@x.test" }],
    }));
    const res = await request(app).get("/api/customers/search?q=alice");
    expect(res.status).toBe(200);
    expect(res.body.results[0].email).toBe("a@x.test");
  });

  it("leaks the raw database error on a broken query (error-based SQLi)", async () => {
    const app = testApp(async () => {
      throw new Error('syntax error at or near "UNION"');
    });
    const res = await request(app).get("/api/customers/search?q='");
    expect(res.status).toBe(500);
    expect(res.body.error).toContain("syntax error");
  });

  it("executes injected shell commands (RCE)", async () => {
    const app = testApp(async () => ({ rows: [] }));
    const res = await request(app).get(
      `/api/net/lookup?host=${encodeURIComponent("127.0.0.1; echo PWNED-9")}`,
    );
    expect(res.body.output).toContain("PWNED-9");
  });

  it("exposes the hardcoded key", async () => {
    const app = testApp(async () => ({ rows: [] }));
    const res = await request(app).get("/api/debug/config");
    expect(res.body.internalApiKey).toBe("sk-vuln-lab-DO-NOT-USE-0000-canary");
  });

  it("returns allocated bytes for a tiny report request", async () => {
    const app = testApp(async () => ({ rows: [] }));
    const res = await request(app).get("/api/report?rows=1");
    expect(res.body.allocatedBytes).toBe(8 * 1024 * 1024);
  });
});
