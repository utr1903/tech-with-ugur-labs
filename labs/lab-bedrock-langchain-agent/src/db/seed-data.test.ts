import { describe, expect, it } from "vitest";
import { CATEGORIES, CITIES, generateSeedData } from "./seed-data.js";

describe("generateSeedData", () => {
  const data = generateSeedData();

  it("is identical on every call", () => {
    expect(generateSeedData()).toEqual(data);
  });

  it("changes when the seed changes", () => {
    expect(generateSeedData(1)).not.toEqual(data);
  });

  it("has 20 customers, 15 products and 60 orders", () => {
    expect(data.customers).toHaveLength(20);
    expect(data.products).toHaveLength(15);
    expect(data.orders).toHaveLength(60);
  });

  it("has unique customer names, emails and product names", () => {
    expect(new Set(data.customers.map((c) => c.name)).size).toBe(20);
    expect(new Set(data.customers.map((c) => c.email)).size).toBe(20);
    expect(new Set(data.products.map((p) => p.name)).size).toBe(15);
  });

  it("uses only the documented cities and categories", () => {
    const cities = CITIES.map((entry) => entry.city);
    for (const customer of data.customers) {
      expect(cities).toContain(customer.city);
    }
    for (const product of data.products) {
      expect(CATEGORIES).toContain(product.category);
    }
  });

  it("has at least two products and one unique lowest stock per category", () => {
    for (const category of CATEGORIES) {
      const stocks = data.products
        .filter((product) => product.category === category)
        .map((product) => product.stock);
      expect(stocks.length).toBeGreaterThanOrEqual(2);
      const lowest = Math.min(...stocks);
      expect(stocks.filter((stock) => stock === lowest)).toHaveLength(1);
    }
  });

  it("references only existing customers and products", () => {
    for (const order of data.orders) {
      expect(order.customerId).toBeGreaterThanOrEqual(1);
      expect(order.customerId).toBeLessThanOrEqual(20);
      expect(order.productId).toBeGreaterThanOrEqual(1);
      expect(order.productId).toBeLessThanOrEqual(15);
    }
  });

  it("gives the last customer exactly one order", () => {
    expect(data.orders.filter((order) => order.customerId === 20)).toHaveLength(
      1,
    );
  });

  it("does not depend on the current date", () => {
    for (const order of data.orders) {
      expect(order.orderedAt.getUTCFullYear()).toBe(2026);
    }
  });
});
