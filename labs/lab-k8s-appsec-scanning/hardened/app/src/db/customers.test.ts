import { describe, expect, it } from "vitest";
import { buildSearchSql, searchCustomers } from "./customers.js";

describe("buildSearchSql", () => {
  it("returns a parameterized query, not interpolated SQL", () => {
    const { text, values } = buildSearchSql("o'brien");
    expect(text).toContain("$1");
    expect(text).not.toContain("o'brien");
    expect(values).toEqual(["%o'brien%"]);
  });
});

describe("searchCustomers", () => {
  it("passes text and values to the driver", async () => {
    const calls: unknown[][] = [];
    const pool = {
      query: async (sql: string, params: string[]) => {
        calls.push([sql, params]);
        return { rows: [] };
      },
    };
    await searchCustomers(pool, "abc");
    expect(calls[0][0]).toContain("$1");
    expect(calls[0][1]).toEqual(["%abc%"]);
  });
});
