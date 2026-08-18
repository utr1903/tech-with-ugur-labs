import { Client } from "pg";
import { loadConfig } from "./config.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "demo-app" });
const config = loadConfig(process.env);

installGlobalErrorHandlers(logger);

logger.info(
  { config: { port: config.port, appVersion: config.appVersion } },
  "Demo app initialized.",
);

// Database client will be initialized in the actual implementation
void Client;
