import { loadConfig } from "./config.js";
import { runMigrations, waitForDb } from "./db/migrations.js";
import { createPool } from "./db/pool.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "demo-app-migrate" });
installGlobalErrorHandlers(logger);

const rawTarget = process.env.MIGRATE_TO;
if (rawTarget === undefined || rawTarget === "") {
  logger.error("Missing required environment variable MIGRATE_TO.");
  process.exit(1);
}
const target = Number.parseInt(rawTarget, 10);

const config = loadConfig(process.env);
const pool = createPool(config.db);

try {
  await waitForDb(pool, logger);
  await runMigrations(pool, target, logger);
  await pool.end();
} catch (err) {
  logger.error({ err, target }, "Migration run failed.");
  process.exit(1);
}
