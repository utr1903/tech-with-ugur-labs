import { loadConfig } from "./config.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { createServer } from "./server.js";

const logger = createLogger({ appName: "upstream" });
installGlobalErrorHandlers(logger);

const cfg = loadConfig(process.env);
const server = createServer(cfg, logger);

server.listen(cfg.port, () => {
  logger.info(
    {
      destination: cfg.destinationName,
      port: cfg.port,
      payloadBytes: cfg.payloadBytes,
    },
    "Starting the destination server succeeded.",
  );
});
