import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { createAppServer } from "./server/http-server.js";

const logger = createLogger({ appName: "demo-app" });
installGlobalErrorHandlers(logger);

const config = loadConfig(process.env);
const pool = createPool(config.db, logger);
const server = createAppServer({ config, pool, logger });

server.listen(config.port, () => {
  logger.info(
    { port: config.port, version: config.appVersion },
    "Server started.",
  );
});
