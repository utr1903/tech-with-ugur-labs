import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { createApp } from "./server/app.js";

const logger = createLogger({ appName: "hardened-app" });
installGlobalErrorHandlers(logger);

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const app = createApp({ pool, logger });

app.listen(config.port, () => {
  logger.info({ port: config.port }, "Hardened app listening.");
});
