import { describe, expect, it } from "vitest";
import { migrations, pendingMigrations } from "./migrations.js";

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
