import { startAgent } from "./agent/service/main.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { startResponder } from "./responder/main.js";

const command = process.argv[2];
const logger = createLogger({ appName: command ?? "soc" });
installGlobalErrorHandlers(logger);

switch (command) {
  case "agent":
    startAgent(logger);
    break;
  case "responder":
    startResponder(logger);
    break;
  default:
    logger.error(
      { command },
      "Starting soc failed: expected agent or responder.",
    );
    process.exit(1);
}
