import { count, eq, isNull } from "drizzle-orm";
import pino from "pino";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "./client.js";
import { customers, orders, products } from "./schema.js";
import { seedDatabase } from "./seed.js";

const { db, pool } = createDatabase(process.env.DATABASE_URL ?? "");
const logger = pino({ level: "silent" });

afterAll(async () => {
  await pool.end();
});

describe("seedDatabase", () => {
  it("has inserted 20 customers, 15 products and 60 orders", async () => {
    const [c] = await db.select({ n: count() }).from(customers);
    const [p] = await db.select({ n: count() }).from(products);
    const [o] = await db.select({ n: count() }).from(orders);
    expect([c?.n, p?.n, o?.n]).toEqual([20, 15, 60]);
  });

  it("does nothing when the data is already there", async () => {
    expect(await seedDatabase(db, logger)).toEqual({ seeded: false });
    const [c] = await db.select({ n: count() }).from(customers);
    expect(c?.n).toBe(20);
  });

  it("leaves no order without its customer", async () => {
    const orphans = await db
      .select({ id: orders.id })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(isNull(customers.id));
    expect(orphans).toEqual([]);
  });

  it("continues ids after the seeded rows", async () => {
    await expect(
      db.transaction(async (tx) => {
        const [row] = await tx
          .insert(products)
          .values({
            name: "Probe",
            category: "Office",
            priceCents: 1,
            stock: 1,
          })
          .returning({ id: products.id });
        expect(row?.id).toBe(16);
        tx.rollback();
      }),
    ).rejects.toThrow();
  });
});
