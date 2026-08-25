import "dotenv/config";
import { loadConfig } from "./config.js";
import { runDrill } from "./drill/runDrill.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "postgres-dr-drill" });
installGlobalErrorHandlers(logger);

try {
  logger.info("Running the disaster-recovery drill...");
  const summary = await runDrill(loadConfig(process.env), logger);
  logger.info({ ...summary }, "Running the disaster-recovery drill succeeded.");
} catch (err) {
  logger.error({ err }, "Running the disaster-recovery drill failed.");
  process.exitCode = 1;
}
