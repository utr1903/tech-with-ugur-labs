import { runReport } from "./commands/report.js";
import { runVerify } from "./commands/verify.js";
import { loadConfig } from "./config.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "analyzer" });
installGlobalErrorHandlers(logger);

const cfg = loadConfig(process.env);
const command = process.argv[2];

if (command === "report") {
  runReport(cfg, logger);
  process.exit(0);
} else if (command === "verify") {
  process.exit(runVerify(cfg, logger));
} else {
  logger.error({ command }, "Unknown command (expected 'report' or 'verify').");
  process.exit(2);
}
