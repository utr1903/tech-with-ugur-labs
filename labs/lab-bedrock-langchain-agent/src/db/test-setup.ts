import pg from "pg";
import pino from "pino";
import { createDatabase } from "./client.js";
import { runMigrations } from "./migrate.js";
import { seedDatabase } from "./seed.js";

/**
 * Vitest global setup. Recreates the test database so every run starts from
 * the same migrated and seeded state, separate from the app's database.
 */
export default async function setup(): Promise<void> {
  const testUrl = new URL(process.env.DATABASE_URL ?? "");
  const name = testUrl.pathname.slice(1);
  if (!/^[a-z_]+_test$/.test(name)) {
    throw new Error("DATABASE_URL must point at a database ending in _test");
  }
  const admin = new pg.Client({
    connectionString: process.env.ADMIN_DATABASE_URL,
  });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const logger = pino({ level: "silent" });
  const { db, pool } = createDatabase(testUrl.toString());
  await runMigrations(db, logger);
  await seedDatabase(db, logger);
  await pool.end();
}
