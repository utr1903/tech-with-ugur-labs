import pino from "pino";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../db/client.js";
import { generateSeedData } from "../../db/seed-data.js";
import { createQueryOrdersTool } from "./query-orders.js";

const { db, pool } = createDatabase(process.env.DATABASE_URL ?? "");
const logger = pino({ level: "silent" });
const seed = generateSeedData();
const tool = createQueryOrdersTool({ db, logger });

afterAll(async () => {
  await pool.end();
});

async function call(input: Record<string, unknown>) {
  return JSON.parse(await tool.invoke(input));
}

describe("query_orders", () => {
  it("is named and described for the model", () => {
    expect(tool.name).toBe("query_orders");
    expect(tool.description).toContain("Use for");
    expect(tool.description).toContain("Do NOT use for");
  });

  it.each(["id", "customer_id", "product_id"] as const)(
    "tells the model that %s is a whole number",
    (field) => {
      expect(tool.schema.shape[field].description).toContain("whole number");
    },
  );

  it("returns ids, not names", async () => {
    const result = await call({ customer_id: 20 });
    expect(result.total).toBe(1);
    const order = seed.orders.find((o) => o.customerId === 20);
    expect(result.rows[0]).toEqual({
      id: order?.id,
      customer_id: 20,
      product_id: order?.productId,
      quantity: order?.quantity,
      status: order?.status,
      ordered_at: order?.orderedAt.toISOString(),
    });
  });

  it("filters by product and by status", async () => {
    const byProduct = seed.orders.filter((o) => o.productId === 1).length;
    expect((await call({ product_id: 1, limit: 100 })).total).toBe(byProduct);
    const shipped = seed.orders.filter((o) => o.status === "shipped").length;
    expect((await call({ status: "shipped", limit: 100 })).total).toBe(shipped);
  });

  it("returns all 60 orders at the maximum limit", async () => {
    const result = await call({ limit: 100 });
    expect(result.rows).toHaveLength(60);
    expect(result.truncated).toBe(false);
  });

  it("returns an empty result for a customer that does not exist", async () => {
    expect((await call({ customer_id: 999 })).total).toBe(0);
  });

  it("rejects a status outside the known list", async () => {
    // Deliberately the wrong type, to check the runtime schema check: the
    // model can send anything, and TypeScript cannot see that at build time.
    await expect(tool.invoke({ status: "lost" } as never)).rejects.toThrow();
  });

  it("treats null filters as not set", async () => {
    const result = await call({ id: null, customer_id: null, status: null });
    expect(result.total).toBe(60);
  });
});

describe("query_orders rejects numbers too large to be a real id", () => {
  it("rejects a digit string far beyond a safe integer before it ever reaches the database", async () => {
    await expect(
      tool.invoke({ customer_id: "99999999999999999999" } as never),
    ).rejects.toThrow();
  });
});

describe("query_orders filters sent as text", () => {
  it("finds the same order whether customer_id is a number or that number as text", async () => {
    const byNumber = await call({ customer_id: 20 });
    const byText = await call({ customer_id: "20" });
    expect(byText).toEqual(byNumber);
  });

  it("returns all 60 orders when the limit is sent as text", async () => {
    const result = await call({ limit: "100" });
    expect(result.rows).toHaveLength(60);
    expect(result.total).toBe(60);
  });

  it("finds the same orders whether product_id is a number or that number as text", async () => {
    const byNumber = await call({ product_id: 1, limit: 100 });
    const byText = await call({ product_id: "1", limit: 100 });
    expect(byText).toEqual(byNumber);
  });
});
