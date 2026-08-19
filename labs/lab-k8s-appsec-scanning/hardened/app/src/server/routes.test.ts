import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { registerRoutes } from "./routes.js";

function testApp(
  query: (sql: string, params: string[]) => Promise<{ rows: unknown[] }>,
) {
  const app = express();
  registerRoutes(app, {
    pool: { query } as never,
    logger: createLogger({ appName: "test" }),
  });
  return app;
}

describe("routes", () => {
  it("returns search results", async () => {
    const app = testApp(async () => ({
      rows: [{ full_name: "Alice", email: "a@x.test" }],
    }));
    const res = await request(app).get("/api/customers/search?q=alice");
    expect(res.status).toBe(200);
    expect(res.body.results[0].email).toBe("a@x.test");
  });

  it("returns a generic error on a broken query, without leaking driver details", async () => {
    const app = testApp(async () => {
      throw new Error('syntax error at or near "UNION"');
    });
    const res = await request(app).get("/api/customers/search?q='");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("search failed");
    expect(res.body.error).not.toContain("syntax error");
  });

  it("rejects an invalid host and does not execute injected commands", async () => {
    const app = testApp(async () => ({ rows: [] }));
    const res = await request(app).get(
      `/api/net/lookup?host=${encodeURIComponent("127.0.0.1; echo PWNED-9")}`,
    );
    expect(res.body.output).toBe("invalid host");
  });

  it("does not expose a debug config endpoint", async () => {
    const app = testApp(async () => ({ rows: [] }));
    const res = await request(app).get("/api/debug/config");
    expect(res.status).toBe(404);
  });

  it("caps the report allocation at MAX_REPORT_ROWS", async () => {
    const app = testApp(async () => ({ rows: [] }));
    const res = await request(app).get("/api/report?rows=999999");
    expect(res.body.allocatedBytes).toBe(4 * 8 * 1024 * 1024);
  });
});
