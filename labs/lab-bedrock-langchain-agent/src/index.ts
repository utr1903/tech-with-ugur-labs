import { parseConfig } from "./config.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const config = parseConfig(process.env);
const logger = createLogger({ appName: "shop-agent", level: config.logLevel });
installGlobalErrorHandlers(logger);
logger.info({ port: config.port }, "Starting the app...");
