import { Hono } from "hono";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import type { CallBudget } from "./budget.js";
import { guardChatRequest } from "./guard.js";
import type { Transport } from "./transport.js";

export function agentRoutes(
  config: Config,
  logger: Logger,
  budget: CallBudget,
  transport: Transport,
): Hono {
  const app = new Hono();

  app.post("/chat/completions", async (c) => {
    const user = c.get("user");

    // Budget FIRST, before the body is read or parsed: a caller who is over
    // budget must not be able to make us do the expensive work anyway.
    const decision = budget.tryConsume(user.id);
    if (!decision.allowed) {
      logger.warn(
        { userId: user.id },
        "Rejecting an agent step: budget spent.",
      );
      c.header("Retry-After", String(decision.retryAfterS));
      return c.json({ error: "Agent call budget exhausted." }, 429);
    }

    const guarded = guardChatRequest(
      await c.req.json().catch(() => null),
      config,
    );
    if (!guarded.ok) {
      logger.warn(
        { userId: user.id, reason: guarded.error },
        "Rejecting an agent step.",
      );
      return c.json({ error: guarded.error }, guarded.status);
    }

    try {
      logger.info(
        { userId: user.id, model: guarded.request.model, mode: config.llmMode },
        "Relaying an agent step...",
      );
      const body = await transport(guarded.request, guarded.request.messages);
      logger.info({ userId: user.id }, "Relaying an agent step succeeded.");
      return c.json(body as Record<string, unknown>);
    } catch (err) {
      logger.error({ err, userId: user.id }, "Relaying an agent step failed.");
      return c.json({ error: "Upstream model call failed." }, 502);
    }
  });

  return app;
}
