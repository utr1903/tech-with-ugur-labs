import { Hono } from "hono";
import type { Logger } from "../logger.js";
import type { PublishNumber } from "../pubsub/publisher.js";

function finiteNumber(payload: unknown): number | undefined {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    !("number" in payload)
  ) {
    return undefined;
  }

  const number = payload.number;
  return typeof number === "number" && Number.isFinite(number)
    ? number
    : undefined;
}

export function createServerApp({
  publish,
  logger,
}: {
  publish: PublishNumber;
  logger: Logger;
}): Hono {
  const app = new Hono();

  app.get("/healthz", (context) => context.json({ status: "ok" }));
  app.post("/", async (context) => {
    let payload: unknown;
    try {
      payload = await context.req.json<unknown>();
    } catch {
      logger.warn("Rejecting invalid JSON payload.");
      return context.json({ error: "Expected a finite JSON number" }, 400);
    }

    const number = finiteNumber(payload);
    if (number === undefined) {
      logger.warn("Rejecting invalid number payload.");
      return context.json({ error: "Expected a finite JSON number" }, 400);
    }

    try {
      const messageId = await publish(number);
      return context.json({ messageId }, 202);
    } catch {
      return context.json({ error: "Message publication failed" }, 503);
    }
  });

  return app;
}
