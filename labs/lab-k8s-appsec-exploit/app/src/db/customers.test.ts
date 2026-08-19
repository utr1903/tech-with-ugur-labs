import { describe, expect, it, vi } from "vitest";
import { buildSearchSql, searchCustomers } from "./customers.js";

describe("buildSearchSql", () => {
  // DELIBERATELY VULNERABLE: input is concatenated, not parameterized.
  it("concatenates the raw query into the SQL string", () => {
    expect(buildSearchSql("alice")).toContain("'%alice%'");
  });

  it("lets a UNION payload change the query shape (SQL injection)", () => {
    const sql = buildSearchSql(
      "' UNION SELECT ssn, credit_card FROM customers--",
    );
    expect(sql).toContain("UNION SELECT ssn, credit_card");
  });
});

describe("searchCustomers", () => {
  it("runs the built SQL verbatim against the pool", async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [{ full_name: "Alice", email: "a@x.test" }] });
    const rows = await searchCustomers({ query }, "alice");
    expect(query).toHaveBeenCalledWith(buildSearchSql("alice"));
    expect(rows).toEqual([{ full_name: "Alice", email: "a@x.test" }]);
  });
});
