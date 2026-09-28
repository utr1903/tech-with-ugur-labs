import { count, sql } from "drizzle-orm";
import type { Logger } from "../logger.js";
import type { Database } from "./client.js";
import { customers, orders, products } from "./schema.js";
import { generateSeedData, SEED } from "./seed-data.js";

/**
 * Inserts the generated dataset in one transaction, unless customers already
 * exist. Ids are inserted explicitly, so the identity sequences are moved
 * past them afterwards.
 */
export async function seedDatabase(
  db: Database,
  logger: Logger,
): Promise<{ seeded: boolean }> {
  try {
    logger.info("Seeding the database...");
    const [existing] = await db.select({ n: count() }).from(customers);
    if ((existing?.n ?? 0) > 0) {
      logger.info({ seeded: false }, "Seeding the database succeeded.");
      return { seeded: false };
    }
    const data = generateSeedData();
    await db.transaction(async (tx) => {
      await tx.insert(customers).values(data.customers);
      await tx.insert(products).values(data.products);
      await tx.insert(orders).values(data.orders);
      for (const table of ["customers", "products", "orders"]) {
        await tx.execute(
          sql`SELECT setval(pg_get_serial_sequence(${table}, 'id'), (SELECT max(id) FROM ${sql.identifier(table)}))`,
        );
      }
    });
    logger.info(
      {
        seeded: true,
        seed: SEED,
        customers: data.customers.length,
        products: data.products.length,
        orders: data.orders.length,
      },
      "Seeding the database succeeded.",
    );
    return { seeded: true };
  } catch (err) {
    logger.error({ err }, "Seeding the database failed.");
    throw err;
  }
}
