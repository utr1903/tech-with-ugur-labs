import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";

const logger = createLogger({ appName: "demo-app" });
const config = loadConfig(process.env);

logger.info({ config }, "Running migrations for version.");
