import { Hono } from "hono";
import { z } from "zod";
import type { Logger } from "../logger.js";
import { COMPONENTS, type FleetStore } from "./store.js";

const reportSchema = z.object({
  component: z.enum(COMPONENTS),
  componentRef: z.string().min(1).max(120),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationHours: z.number().min(0).max(24),
  summary: z.string().min(1).max(2000),
  followUpRequired: z.boolean(),
  followUpNote: z.string().max(2000),
});

export function fleetRoutes(store: FleetStore, logger: Logger): Hono {
  const app = new Hono();

  app.get("/sites", (c) => c.json(store.listSites()));

  app.get("/sites/:id", (c) => {
    const site = store.getSite(c.req.param("id"));
    return site ? c.json(site) : c.json({ error: "Unknown site." }, 404);
  });

  app.get("/reports", (c) => c.json(store.listReports()));

  app.post("/sites/:id/reports", async (c) => {
    const siteId = c.req.param("id");
    const user = c.get("user");
    const parsed = reportSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid report." }, 400);
    if (!store.getSite(siteId)) return c.json({ error: "Unknown site." }, 404);
    try {
      logger.info(
        { siteId, userId: user.id },
        "Filing a maintenance report...",
      );
      const report = store.addReport({ ...parsed.data, siteId }, user);
      logger.info(
        { siteId, reportId: report.id },
        "Filing a maintenance report succeeded.",
      );
      return c.json(report, 201);
    } catch (err) {
      logger.error(
        { err, siteId, userId: user.id },
        "Filing a maintenance report failed.",
      );
      throw err;
    }
  });

  return app;
}
