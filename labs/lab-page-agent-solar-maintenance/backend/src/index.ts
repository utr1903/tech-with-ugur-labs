import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { CallBudget } from "./agent/budget.js";
import { agentRoutes } from "./agent/routes.js";
import { createTransport } from "./agent/transport.js";
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
const budget = new CallBudget(
  config.agentCallBudget,
  config.agentBudgetWindowS,
);
const transport = createTransport(config, logger);
const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

// Public: you cannot present a token before you have one.
app.route("/api/auth", authRoutes(config, logger));

// Everything else under /api requires a session, by construction.
const api = new Hono();
api.use("*", requireAuth(config.jwtSecret));
api.route("/", fleetRoutes(store, logger));
api.route("/agent/v1", agentRoutes(config, logger, budget, transport));
app.route("/api", api);

// Hono's default error handler prints a raw multi-line stack trace to stderr,
// which breaks line-oriented JSON log consumers. Log it through pino instead
// and answer with nothing the caller can learn from.
app.onError((err, c) => {
  logger.error({ err, path: c.req.path }, "Handling a request failed.");
  return c.json({ error: "Internal server error." }, 500);
});

logger.info(
  { port: config.port, llmMode: config.llmMode },
  "Starting the backend...",
);
serve({ fetch: app.fetch, port: config.port });
logger.info({ port: config.port }, "Starting the backend succeeded.");
