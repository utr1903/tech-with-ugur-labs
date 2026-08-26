import { describe, expect, it } from "vitest";
import { buildTableChecksumQuery, diffChecksums } from "./checksums.js";

describe("buildTableChecksumQuery", () => {
  it("builds an order-independent aggregate over row hashes", () => {
    const query = buildTableChecksumQuery("orders");
    expect(query).toContain("md5");
    expect(query).toContain("ORDER BY row_hash");
    expect(query).toContain("FROM orders");
  });

  it("hashes the empty table to a stable sentinel", () => {
    expect(buildTableChecksumQuery("orders")).toContain("'empty'");
  });

  it("rejects unsafe table names", () => {
    expect(() => buildTableChecksumQuery("orders; DROP TABLE x")).toThrow(
      "Unsafe table name",
    );
    expect(() => buildTableChecksumQuery('or"ders')).toThrow(
      "Unsafe table name",
    );
  });
});

describe("diffChecksums", () => {
  it("returns an empty list for identical checksum maps", () => {
    const a = { orders: "aaa", control_totals: "bbb" };
    expect(diffChecksums(a, { ...a })).toEqual([]);
  });

  it("lists tables whose checksum changed", () => {
    expect(
      diffChecksums(
        { orders: "aaa", control_totals: "bbb" },
        { orders: "zzz", control_totals: "bbb" },
      ),
    ).toEqual(["orders"]);
  });

  it("lists tables missing from either side", () => {
    expect(diffChecksums({ orders: "aaa" }, {})).toEqual(["orders"]);
    expect(diffChecksums({}, { orders: "aaa" })).toEqual(["orders"]);
  });
});
