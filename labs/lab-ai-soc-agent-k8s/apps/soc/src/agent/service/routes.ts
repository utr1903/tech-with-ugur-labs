import { type Context, Hono, type Next } from "hono";
import { z } from "zod";
import { bearerMatches } from "../../shared/auth.js";
import { parseAlertmanagerPayload } from "./alertmanager.js";
import type { Deduper } from "./dedupe.js";
import { type Job, type JobDeps, runJob } from "./job.js";
import type { Queue } from "./queue.js";
import { renderMarkdown } from "./render.js";
import { newReportId } from "./reports.js";

export type AgentDeps = JobDeps & {
  agentToken: string;
  queue: Queue;
  deduper: Deduper;
};

const HuntSchema = z.object({
  windowMinutes: z.number().int().min(1).max(1440).optional(),
});

function requireToken(expected: string) {
  return async (c: Context, next: Next) => {
    if (!bearerMatches(c.req.header("authorization"), expected)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}

function enqueue(deps: AgentDeps, job: Job): void {
  const jobDeps = {
    ...deps,
    onError: (j: Job) =>
      deps.deduper.forget(
        j.alerts.map((a) => a.fingerprint),
        j.id,
      ),
  };
  deps.queue
    .enqueue(() => runJob(jobDeps, job))
    .catch((err) => {
      deps.logger.error({ err, reportId: job.id }, "Job failed.");
    });
}

function addTriggerRoutes(app: Hono, deps: AgentDeps): void {
  app.post("/investigate", async (c) => {
    let alerts: ReturnType<typeof parseAlertmanagerPayload>;
    try {
      alerts = parseAlertmanagerPayload(await c.req.json());
    } catch {
      return c.json({ error: "invalid Alertmanager payload" }, 400);
    }
    const { fresh, relatedTo } = deps.deduper.filterNew(alerts);
    if (fresh.length === 0) {
      return c.json({ accepted: false, skipped: "no new alerts" }, 202);
    }
    const id = newReportId("investigate", deps.now());
    deps.deduper.remember(
      fresh.map((a) => a.fingerprint),
      id,
    );
    deps.logger.info(
      { reportId: id, alerts: fresh.length },
      "Accepted alerts.",
    );
    enqueue(deps, { id, mode: "investigate", alerts: fresh, relatedTo });
    return c.json({ accepted: true, reportId: id }, 202);
  });

  app.post("/hunt", async (c) => {
    const parsed = HuntSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    const id = newReportId("hunt", deps.now());
    deps.logger.info({ reportId: id }, "Accepted hunt.");
    enqueue(deps, {
      id,
      mode: "hunt",
      alerts: [],
      huntWindowMinutes: parsed.data.windowMinutes,
    });
    return c.json({ reportId: id }, 202);
  });
}

function addReportRoutes(app: Hono, deps: AgentDeps): void {
  app.get("/reports", async (c) =>
    c.json({ reports: await deps.store.list() }),
  );
  app.get("/reports/:id", async (c) => {
    const found = await deps.store.get(c.req.param("id"));
    if (!found) return c.json({ error: "not found" }, 404);
    if (c.req.query("format") === "md") {
      return c.body(renderMarkdown(found), 200, {
        "content-type": "text/markdown; charset=utf-8",
      });
    }
    return c.json(found);
  });
}

export function createApp(deps: AgentDeps): Hono {
  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true, queue: deps.queue.size() }));
  const auth = requireToken(deps.agentToken);
  for (const path of ["/investigate", "/hunt", "/reports", "/reports/*"]) {
    app.use(path, auth);
  }
  addTriggerRoutes(app, deps);
  addReportRoutes(app, deps);
  return app;
}
