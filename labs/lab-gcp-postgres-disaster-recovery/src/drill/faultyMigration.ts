import type pg from "pg";
import type { Logger } from "../logger.js";

// The "cents to euros" migration a team might ship in a hurry. The bug:
// `unit_price_cents / 100` is INTEGER division in Postgres, so 199
// cents becomes 1.00 euros instead of 1.99 — and because every
// statement commits, the damage is durable the moment it runs. A
// correct migration would divide by 100.0. Nothing here errors; the
// corruption is completely silent.
const FAULTY_MIGRATION_STATEMENTS = [
  "ALTER TABLE orders ALTER COLUMN unit_price_cents TYPE numeric(10,2) USING unit_price_cents / 100",
  "ALTER TABLE orders RENAME COLUMN unit_price_cents TO unit_price_eur",
  "ALTER TABLE orders ALTER COLUMN total_cents TYPE numeric(10,2) USING total_cents / 100",
  "ALTER TABLE orders RENAME COLUMN total_cents TO total_eur",
];

export async function applyFaultyMigration(
  client: pg.Client,
  logger: Logger,
): Promise<void> {
  try {
    logger.info(
      { statementCount: FAULTY_MIGRATION_STATEMENTS.length },
      "Applying the faulty migration...",
    );
    for (const statement of FAULTY_MIGRATION_STATEMENTS) {
      await client.query(statement);
    }
    logger.info(
      { statementCount: FAULTY_MIGRATION_STATEMENTS.length },
      "Applying the faulty migration succeeded.",
    );
  } catch (err) {
    logger.error(
      { err, statementCount: FAULTY_MIGRATION_STATEMENTS.length },
      "Applying the faulty migration failed.",
    );
    throw err;
  }
}
