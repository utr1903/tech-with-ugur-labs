import { createServer } from "node:http";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { createHandler } from "./server/handler.js";

const logger = createLogger({ appName: "webhook-app" });
installGlobalErrorHandlers(logger);

const port = Number(process.env.PORT ?? 8080);
const server = createServer(createHandler({ logger }));

server.listen(port, () => {
  logger.info({ port }, "Starting webhook server succeeded.");
});
