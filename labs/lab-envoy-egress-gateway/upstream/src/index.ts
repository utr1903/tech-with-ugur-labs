import type { UpstreamConfig } from "./config.js";
import { loadConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { createServer } from "./server.js";

function startServer(
  server: ReturnType<typeof createServer>,
  cfg: UpstreamConfig,
  logger: Logger,
): void {
  const fields = {
    destination: cfg.destinationName,
    port: cfg.port,
    payloadBytes: cfg.payloadBytes,
  };
  logger.info(fields, "Starting the destination server...");
  server.on("error", (err) => {
    logger.error({ err, ...fields }, "Starting the destination server failed.");
    process.exit(1);
  });
  server.listen(cfg.port, () => {
    logger.info(fields, "Starting the destination server succeeded.");
  });
}

const logger = createLogger({ appName: "upstream" });
installGlobalErrorHandlers(logger);

const cfg = loadConfig(process.env);
const server = createServer(cfg, logger);

startServer(server, cfg, logger);
