import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "garden-agent" });
installGlobalErrorHandlers(logger);
logger.info("Garden agent starting...");
