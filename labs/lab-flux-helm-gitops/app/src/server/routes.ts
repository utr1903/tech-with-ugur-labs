import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { listMessages, messagesQuery } from "../db/messages.js";
import type { Logger } from "../logger.js";
import { isAuthorized } from "./auth.js";

export type RouteDeps = {
  config: AppConfig;
  pool: Pool;
  logger: Logger;
};

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function handleReadyz(
  deps: RouteDeps,
  res: ServerResponse,
): Promise<void> {
  try {
    await deps.pool.query(`${messagesQuery(deps.config.appVersion)} LIMIT 1`);
    sendJson(res, 200, { status: "ready" });
  } catch (err) {
    deps.logger.warn({ err }, "Readiness check failed.");
    sendJson(res, 503, { status: "unavailable" });
  }
}

async function handleMessages(
  deps: RouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!isAuthorized(req.headers.authorization, deps.config.apiToken)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  try {
    deps.logger.info(
      { version: deps.config.appVersion },
      "Listing messages...",
    );
    const messages = await listMessages(deps.pool, deps.config.appVersion);
    deps.logger.info({ count: messages.length }, "Listing messages succeeded.");
    sendJson(res, 200, { version: deps.config.appVersion, messages });
  } catch (err) {
    deps.logger.error({ err }, "Listing messages failed.");
    sendJson(res, 500, { error: "internal error" });
  }
}

export async function handleRequest(
  deps: RouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  switch (req.url) {
    case "/healthz":
      sendJson(res, 200, { status: "ok", version: deps.config.appVersion });
      return;
    case "/readyz":
      await handleReadyz(deps, res);
      return;
    case "/api/messages":
      await handleMessages(deps, req, res);
      return;
    default:
      sendJson(res, 404, { error: "not found" });
  }
}
