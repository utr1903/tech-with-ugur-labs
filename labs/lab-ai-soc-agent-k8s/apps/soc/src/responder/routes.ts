import { type Context, Hono, type Next } from "hono";
import { ActionRequestSchema } from "../shared/actions.js";
import { bearerMatches } from "../shared/auth.js";
import {
  ApprovalAlreadyResolvedError,
  ApprovalNotFoundError,
} from "./approvals.js";
import type { ResponderDeps } from "./deps.js";
import { processActions } from "./process-actions.js";
import { resolveApproval } from "./resolve-approval.js";

const DNS_NAME = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;

function requireToken(expected: string) {
  return async (c: Context, next: Next) => {
    if (!bearerMatches(c.req.header("authorization"), expected)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}

function addApprovalRoutes(app: Hono, deps: ResponderDeps): void {
  const resolve = (decision: "approved" | "denied") => async (c: Context) => {
    try {
      return c.json(
        await resolveApproval(deps, c.req.param("id") ?? "", decision),
      );
    } catch (err) {
      if (err instanceof ApprovalNotFoundError)
        return c.json({ error: err.message }, 404);
      if (err instanceof ApprovalAlreadyResolvedError)
        return c.json({ error: err.message }, 409);
      deps.logger.error({ err }, "Resolving approval failed.");
      return c.json({ error: "internal error" }, 500);
    }
  };
  app.get("/approvals", async (c) =>
    c.json({ approvals: await deps.approvals.list() }),
  );
  app.post("/approvals/:id/approve", resolve("approved"));
  app.post("/approvals/:id/deny", resolve("denied"));
  app.get("/audit", async (c) => c.json({ entries: await deps.audit.read() }));
}

function addSecretRoutes(app: Hono, deps: ResponderDeps): void {
  app.get("/secrets/:namespace", async (c) => {
    const namespace = c.req.param("namespace");
    if (!DNS_NAME.test(namespace))
      return c.json({ error: "invalid namespace" }, 400);
    return c.json(await deps.secrets.list(namespace));
  });
  app.get("/secrets/:namespace/:name", async (c) => {
    const { namespace, name } = c.req.param();
    if (!DNS_NAME.test(namespace) || !DNS_NAME.test(name)) {
      return c.json({ error: "invalid namespace or name" }, 400);
    }
    const found = await deps.secrets.get(namespace, name);
    return found ? c.json([found]) : c.json({ error: "not found" }, 404);
  });
}

export function createApp(deps: ResponderDeps): Hono {
  const app = new Hono();
  const agent = requireToken(deps.responderToken);
  const admin = requireToken(deps.adminToken);

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.use("/actions", agent);
  app.use("/secrets/*", agent);
  app.use("/approvals", admin);
  app.use("/approvals/*", admin);
  app.use("/audit", admin);

  app.post("/actions", async (c) => {
    const parsed = ActionRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json(
        { error: "invalid request", issues: parsed.error.issues },
        400,
      );
    }
    return c.json({ outcomes: await processActions(deps, parsed.data) });
  });
  addApprovalRoutes(app, deps);
  addSecretRoutes(app, deps);
  return app;
}
