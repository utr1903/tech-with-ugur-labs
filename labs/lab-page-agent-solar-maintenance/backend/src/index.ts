import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { requireAuth } from "./auth/middleware.js";
import { authRoutes } from "./auth/routes.js";
import { loadConfig } from "./config.js";
import { fleetRoutes } from "./fleet/routes.js";
import { FleetStore } from "./fleet/store.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "solar-logbook-backend" });
installGlobalErrorHandlers(logger);

const config = loadConfig(process.env);
const store = new FleetStore();
const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

// Public: you cannot present a token before you have one.
app.route("/api/auth", authRoutes(config, logger));

// Everything else under /api requires a session, by construction.
const api = new Hono();
api.use("*", requireAuth(config.jwtSecret));
api.route("/", fleetRoutes(store, logger));
app.route("/api", api);

logger.info(
  { port: config.port, llmMode: config.llmMode },
  "Starting the backend...",
);
serve({ fetch: app.fetch, port: config.port });
logger.info({ port: config.port }, "Starting the backend succeeded.");
