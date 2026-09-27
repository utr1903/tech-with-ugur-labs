import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Logger } from "../logger.js";
import type { Database } from "./client.js";

/** Brings the schema up to date; safe to run on every startup. */
export async function runMigrations(
  db: Database,
  logger: Logger,
): Promise<void> {
  try {
    logger.info("Applying migrations...");
    await migrate(db, { migrationsFolder: "drizzle" });
    logger.info("Applying migrations succeeded.");
  } catch (err) {
    logger.error({ err }, "Applying migrations failed.");
    throw err;
  }
}
