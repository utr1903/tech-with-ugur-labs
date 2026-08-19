import type { Express, Request, Response } from "express";
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
      logger.error({ err, q }, "Searching customers failed.");
      res.status(500).json({ error: "search failed" });
    }
  });

  app.get("/api/net/lookup", async (req: Request, res: Response) => {
    const host = String(req.query.host ?? "127.0.0.1");
    logger.info({ host }, "Running network lookup...");
    const output = await runLookup(host);
    logger.info("Running network lookup succeeded.");
    res.json({ output });
  });

  app.get("/api/report", (req: Request, res: Response) => {
    const rows = Number(req.query.rows ?? "0");
    logger.info({ rows }, "Building report...");
    const { bytes } = buildReport(rows);
    res.json({ allocatedBytes: bytes });
  });
}
