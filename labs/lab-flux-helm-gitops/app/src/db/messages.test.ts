import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger.js";
import { listMessages, messagesQuery } from "./messages.js";
import { createPool } from "./pool.js";

describe("messagesQuery", () => {
  it("selects body only for version 1", () => {
    expect(messagesQuery(1)).toBe("SELECT id, body FROM messages ORDER BY id");
  });

  it("selects author as well for version 2", () => {
    expect(messagesQuery(2)).toBe(
      "SELECT id, body, author FROM messages ORDER BY id",
    );
  });
});

describe("listMessages", () => {
  it("returns the rows from the versioned query", async () => {
    const rows = [{ id: 1, body: "hello from schema v1" }];
    const pool = {
      query: vi.fn().mockResolvedValue({ rows }),
    } as unknown as Pool;
    await expect(listMessages(pool, 1)).resolves.toEqual(rows);
    expect(pool.query).toHaveBeenCalledWith(
      "SELECT id, body FROM messages ORDER BY id",
    );
  });
});

describe("createPool", () => {
  it("attaches error handler to pool", () => {
    const mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;
    const dbConfig = {
      host: "localhost",
      port: 5432,
      database: "demo",
      user: "demo",
      password: "password",
    };

    const pool = createPool(dbConfig, mockLogger);
    const listeners = pool.listeners("error");
    expect(listeners).toHaveLength(1);
    pool.end();
  });
});
