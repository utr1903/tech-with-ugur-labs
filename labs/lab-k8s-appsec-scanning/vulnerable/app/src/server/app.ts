import express, { type Express } from "express";
import type { Pool } from "pg";
import type { Logger } from "../logger.js";
import { registerRoutes } from "./routes.js";

export type AppDeps = { pool: Pool; logger: Logger };

export function createApp({ pool, logger }: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    logger.debug("Health check.");
    res.json({ status: "ok" });
  });

  registerRoutes(app, { pool, logger });
  return app;
}
