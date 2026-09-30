import { runReport } from "./commands/report.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "deep-agents-url-report" });
installGlobalErrorHandlers(logger);
const result = await runReport(process.argv.slice(2).join(" "), logger);
process.exitCode = result.exitCode;
