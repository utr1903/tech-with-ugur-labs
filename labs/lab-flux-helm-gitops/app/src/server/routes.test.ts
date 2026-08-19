import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { createAppServer } from "./http-server.js";

const config: AppConfig = {
  port: 0,
  appVersion: 2,
  apiToken: "secret-token",
  db: {
    host: "db",
    port: 5432,
    database: "demo",
    user: "demo",
    password: "pw",
  },
};

const logger = createLogger({ appName: "test" });
let close: (() => Promise<void>) | undefined;

async function startServer(pool: Pool): Promise<string> {
  const server = createAppServer({ config, pool, logger });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  close = () => new Promise((resolve) => server.close(() => resolve()));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await close?.();
});

describe("routes", () => {
  it("serves /healthz without auth or db", async () => {
    const pool = { query: vi.fn() } as unknown as Pool;
    const base = await startServer(pool);
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok", version: 2 });
  });

  it("reports ready when the versioned query works", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Pool;
    const base = await startServer(pool);
    const res = await fetch(`${base}/readyz`);
    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("author"));
  });

  it("reports unavailable when the query fails", async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error("column does not exist")),
    } as unknown as Pool;
    const base = await startServer(pool);
    const res = await fetch(`${base}/readyz`);
    expect(res.status).toBe(503);
  });

  it("rejects /api/messages without the token", async () => {
    const pool = { query: vi.fn() } as unknown as Pool;
    const base = await startServer(pool);
    const res = await fetch(`${base}/api/messages`);
    expect(res.status).toBe(401);
  });

  it("serves messages with the token", async () => {
    const rows = [{ id: 1, body: "hello from schema v2", author: "flux" }];
    const pool = {
      query: vi.fn().mockResolvedValue({ rows }),
    } as unknown as Pool;
    const base = await startServer(pool);
    const res = await fetch(`${base}/api/messages`, {
      headers: { authorization: "Bearer secret-token" },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ version: 2, messages: rows });
  });

  it("returns 404 for unknown paths", async () => {
    const pool = { query: vi.fn() } as unknown as Pool;
    const base = await startServer(pool);
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });
});
