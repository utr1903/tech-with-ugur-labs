import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "../logger.js";
import { summarizeAlerts } from "./alert-payload.js";

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createHandler({ logger }: { logger: Logger }) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    handle(req, res, logger).catch((err: unknown) => {
      logger.error({ err }, "Handling request failed.");
      if (!res.destroyed) {
        res.destroy();
      }
    });
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
): Promise<void> {
  if (req.method === "GET" && req.url === "/healthz") {
    respond(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && req.url === "/alerts") {
    try {
      const body = await readBody(req);
      logger.info({ bytes: body.length }, "Receiving alert...");
      const payload: unknown = JSON.parse(body);
      logger.debug({ payload }, "Receiving alert payload.");
      for (const summary of summarizeAlerts(payload)) {
        logger.info(
          {
            alertname: summary.alertname,
            status: summary.status,
            labels: summary.labels,
          },
          "Receiving alert succeeded.",
        );
      }
      respond(res, 200, { ok: true });
    } catch (err) {
      logger.error({ err }, "Receiving alert failed.");
      respond(res, 400, { ok: false });
    }
    return;
  }
  respond(res, 404, { ok: false });
}
