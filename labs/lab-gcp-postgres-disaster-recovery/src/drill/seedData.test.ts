import { describe, expect, it } from "vitest";
import { generateOrders, grandTotalCents } from "./seedData.js";

describe("generateOrders", () => {
  it("is deterministic", () => {
    expect(generateOrders(500)).toEqual(generateOrders(500));
  });

  it("satisfies the total = quantity * unit price invariant on every row", () => {
    for (const order of generateOrders(500)) {
      expect(order.totalCents).toBe(order.quantity * order.unitPriceCents);
    }
  });

  it("contains prices that a truncating cents-to-euros division corrupts", () => {
    const truncatable = generateOrders(500).filter(
      (order) => order.unitPriceCents % 100 !== 0,
    );
    expect(truncatable.length).toBeGreaterThan(400);
  });

  it("produces the requested number of orders with unique ids", () => {
    const orders = generateOrders(500);
    expect(orders).toHaveLength(500);
    expect(new Set(orders.map((o) => o.id)).size).toBe(500);
  });
});

describe("grandTotalCents", () => {
  it("sums all order totals", () => {
    expect(
      grandTotalCents([
        { id: 1, item: "a", quantity: 2, unitPriceCents: 100, totalCents: 200 },
        { id: 2, item: "b", quantity: 1, unitPriceCents: 250, totalCents: 250 },
      ]),
    ).toBe(450);
  });
});
