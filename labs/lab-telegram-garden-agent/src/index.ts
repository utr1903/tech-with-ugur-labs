import { loadConfig } from "./config.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "garden-agent" });
installGlobalErrorHandlers(logger);
const config = loadConfig(process.env);
logger.info({ transport: config.transport }, "Config loaded.");
logger.info("Garden agent starting...");
