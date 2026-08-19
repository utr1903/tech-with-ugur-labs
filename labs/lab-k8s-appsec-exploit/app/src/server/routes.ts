import type { Express, Request, Response } from "express";
import { INTERNAL_API_KEY } from "../config.js";
import type { Queryable } from "../db/customers.js";
import { searchCustomers } from "../db/customers.js";
import type { Logger } from "../logger.js";
import { runLookup } from "../system/lookup.js";
import { buildReport } from "../system/report.js";

export type RouteDeps = { pool: Queryable; logger: Logger };

export function registerRoutes(app: Express, deps: RouteDeps): void {
  const { pool, logger } = deps;

  app.get("/api/customers/search", async (req: Request, res: Response) => {
    const q = String(req.query.q ?? "");
    try {
      logger.info({ q }, "Searching customers...");
      const results = await searchCustomers(pool, q);
      logger.info({ count: results.length }, "Searching customers succeeded.");
      res.json({ results });
    } catch (err) {
      // DELIBERATELY VULNERABLE: the raw driver error (which echoes the failing
      // SQL) is returned to the client, enabling error-based SQL injection.
      logger.error({ err, q }, "Searching customers failed.");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/net/lookup", async (req: Request, res: Response) => {
    const host = String(req.query.host ?? "127.0.0.1");
    logger.info({ host }, "Running network lookup...");
    const output = await runLookup(host);
    logger.info("Running network lookup succeeded.");
    res.json({ output });
  });

  app.get("/api/debug/config", (_req: Request, res: Response) => {
    // DELIBERATELY VULNERABLE: a debug endpoint dumps secrets to any caller.
    res.json({
      internalApiKey: INTERNAL_API_KEY,
      databaseUrl: process.env.DATABASE_URL ?? "",
      nodeEnv: process.env.NODE_ENV ?? "development",
    });
  });

  app.get("/api/report", (req: Request, res: Response) => {
    const rows = Number(req.query.rows ?? "0");
    logger.warn({ rows }, "Building report (unbounded allocation)...");
    const { bytes } = buildReport(rows);
    res.json({ allocatedBytes: bytes });
  });
}
