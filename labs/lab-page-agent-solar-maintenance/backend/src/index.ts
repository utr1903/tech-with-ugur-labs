import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { authRoutes } from "./auth/routes.js";
import { loadConfig } from "./config.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "solar-logbook-backend" });
installGlobalErrorHandlers(logger);

const config = loadConfig(process.env);
const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));
app.route("/api/auth", authRoutes(config, logger));

logger.info(
  { port: config.port, llmMode: config.llmMode },
  "Starting the backend...",
);
serve({ fetch: app.fetch, port: config.port });
logger.info({ port: config.port }, "Starting the backend succeeded.");
