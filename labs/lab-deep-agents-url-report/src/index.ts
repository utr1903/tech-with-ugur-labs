import { runReport } from "./commands/report.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "deep-agents-url-report" });
installGlobalErrorHandlers(logger);
await runReport(process.argv.slice(2).join(" "), logger);
