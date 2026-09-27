import pino from "pino";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../db/client.js";
import { generateSeedData } from "../../db/seed-data.js";
import { createQueryProductsTool } from "./query-products.js";

const { db, pool } = createDatabase(process.env.DATABASE_URL ?? "");
const logger = pino({ level: "silent" });
const seed = generateSeedData();
const tool = createQueryProductsTool({ db, logger });

afterAll(async () => {
  await pool.end();
});

async function call(input: Record<string, unknown>) {
  return JSON.parse(await tool.invoke(input));
}

const first = seed.products[0];
if (!first) throw new Error("seed has no products");

describe("query_products", () => {
  it("is named and described for the model", () => {
    expect(tool.name).toBe("query_products");
    expect(tool.description).toContain("Use for");
    expect(tool.description).toContain("Do NOT use for");
  });

  it("tells the model that id is a whole number", () => {
    expect(tool.schema.shape.id.description).toContain("whole number");
  });

  it("returns cents and a formatted price", async () => {
    const result = await call({ id: first.id });
    expect(result.rows).toEqual([
      {
        id: first.id,
        name: first.name,
        category: first.category,
        price_cents: first.priceCents,
        price: (first.priceCents / 100).toFixed(2),
        stock: first.stock,
      },
    ]);
  });

  it("formats whole and small amounts with two decimals", async () => {
    const rows = (await call({ limit: 100 })).rows as {
      price_cents: number;
      price: string;
    }[];
    for (const row of rows) {
      expect(row.price).toMatch(/^\d+\.\d{2}$/);
      expect(Math.round(Number(row.price) * 100)).toBe(row.price_cents);
    }
  });

  it("matches part of a name in any letter case", async () => {
    const result = await call({ name: first.name.toLowerCase().slice(0, 5) });
    expect(result.rows.map((row: { id: number }) => row.id)).toContain(
      first.id,
    );
  });

  it("filters by category in any letter case", async () => {
    const expected = seed.products.filter((p) => p.category === first.category);
    const result = await call({ category: first.category.toUpperCase() });
    expect(result.total).toBe(expected.length);
  });

  it("returns an empty result for an unknown category", async () => {
    expect(await call({ category: "Toys" })).toEqual({
      ok: true,
      rows: [],
      total: 0,
      truncated: false,
    });
  });

  it("treats null filters as not set and wildcards literally", async () => {
    expect((await call({ id: null, name: null, category: null })).total).toBe(
      15,
    );
    expect((await call({ name: "%" })).total).toBe(0);
  });
});

describe("query_products filters sent as text", () => {
  it("finds the same product whether id is a number or that number as text", async () => {
    const byNumber = await call({ id: first.id });
    const byText = await call({ id: String(first.id) });
    expect(byText).toEqual(byNumber);
  });
});
