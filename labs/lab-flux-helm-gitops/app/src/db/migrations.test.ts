import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger.js";
import { migrations, pendingMigrations, runMigrations } from "./migrations.js";

describe("migrations catalog", () => {
  it("contains migrations 1 and 2 in order", () => {
    expect(migrations.map((m) => m.id)).toEqual([1, 2]);
  });

  it("migration 1 creates the messages table, migration 2 adds author", () => {
    expect(migrations[0]?.sql).toMatch(/CREATE TABLE IF NOT EXISTS messages/);
    expect(migrations[1]?.sql).toMatch(/ADD COLUMN IF NOT EXISTS author/);
  });
});

describe("pendingMigrations", () => {
  it("returns everything up to the target when nothing is applied", () => {
    expect(pendingMigrations([], 2).map((m) => m.id)).toEqual([1, 2]);
  });

  it("stops at the target version", () => {
    expect(pendingMigrations([], 1).map((m) => m.id)).toEqual([1]);
  });

  it("skips already-applied migrations", () => {
    expect(pendingMigrations([1], 2).map((m) => m.id)).toEqual([2]);
  });

  it("returns nothing when up to date", () => {
    expect(pendingMigrations([1, 2], 2)).toEqual([]);
  });
});

describe("runMigrations", () => {
  it("applies pending migrations using a single client connection", async () => {
    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    } as unknown as Pool;
    const mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;

    // Mock schema_migrations table is empty (no migrations applied yet)
    mockClient.query.mockResolvedValueOnce(undefined); // CREATE TABLE schema_migrations
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // SELECT id FROM schema_migrations
    mockClient.query.mockResolvedValueOnce(undefined); // BEGIN (migration 1)
    mockClient.query.mockResolvedValueOnce(undefined); // migration 1 sql
    mockClient.query.mockResolvedValueOnce(undefined); // INSERT schema_migrations
    mockClient.query.mockResolvedValueOnce(undefined); // COMMIT
    mockClient.query.mockResolvedValueOnce(undefined); // BEGIN (migration 2)
    mockClient.query.mockResolvedValueOnce(undefined); // migration 2 sql
    mockClient.query.mockResolvedValueOnce(undefined); // INSERT schema_migrations
    mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

    const applied = await runMigrations(mockPool, 2, mockLogger);

    expect(applied).toBe(2);
    expect(mockClient.release).toHaveBeenCalledOnce();
    expect(mockPool.connect).toHaveBeenCalledOnce();
  });
});
