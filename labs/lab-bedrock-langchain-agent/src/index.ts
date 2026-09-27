import { MODEL_KEYS } from "./agent/models.js";
import { createTools } from "./agent/tools/index.js";
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

// The tools are built at startup so a problem building them stops the app
// before it accepts requests.
const tools = createTools({ db, logger });
logger.info(
  { tools: tools.map((tool) => tool.name), models: MODEL_KEYS },
  "Agent ready.",
);
