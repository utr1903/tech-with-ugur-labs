import { parseConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { seedDatabase } from "./db/seed.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

// Startup order matters: the server must not listen before the schema and
// the data exist, so that a ready answer means "you can ask questions now".
const config = parseConfig(process.env);
const logger = createLogger({ appName: "shop-agent", level: config.logLevel });
installGlobalErrorHandlers(logger);
logger.info({ port: config.port }, "Starting the app...");

const { db } = createDatabase(config.databaseUrl);
await runMigrations(db, logger);
await seedDatabase(db, logger);
