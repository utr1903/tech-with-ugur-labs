import type pg from "pg";
import type { Logger } from "../logger.js";
import { grandTotalCents, type Order } from "./seedData.js";

const SCHEMA_STATEMENTS = [
  "DROP TABLE IF EXISTS orders",
  "DROP TABLE IF EXISTS control_totals",
  `CREATE TABLE orders (
    id int PRIMARY KEY,
    item text NOT NULL,
    quantity int NOT NULL,
    unit_price_cents int NOT NULL,
    total_cents int NOT NULL
  )`,
  `CREATE TABLE control_totals (
    id int PRIMARY KEY,
    grand_total_cents bigint NOT NULL
  )`,
];

export async function seedDatabase(
  client: pg.Client,
  orders: Order[],
  logger: Logger,
): Promise<void> {
  try {
    logger.info({ orderCount: orders.length }, "Seeding the database...");
    for (const statement of SCHEMA_STATEMENTS) {
      await client.query(statement);
    }
    const values: string[] = [];
    const params: (number | string)[] = [];
    orders.forEach((order, i) => {
      const base = i * 5;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`,
      );
      params.push(
        order.id,
        order.item,
        order.quantity,
        order.unitPriceCents,
        order.totalCents,
      );
    });
    await client.query(
      `INSERT INTO orders (id, item, quantity, unit_price_cents, total_cents) VALUES ${values.join(", ")}`,
      params,
    );
    // The control total is written down BEFORE anything can go wrong;
    // it is the ground truth the invariant check compares against.
    await client.query(
      "INSERT INTO control_totals (id, grand_total_cents) VALUES (1, $1)",
      [grandTotalCents(orders)],
    );
    logger.info(
      { orderCount: orders.length, grandTotalCents: grandTotalCents(orders) },
      "Seeding the database succeeded.",
    );
  } catch (err) {
    logger.error({ err }, "Seeding the database failed.");
    throw err;
  }
}
