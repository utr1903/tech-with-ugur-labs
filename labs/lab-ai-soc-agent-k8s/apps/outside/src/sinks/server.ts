import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Logger } from "../logger.js";
import { HitStore } from "./hits.js";
import { loadStage } from "./stage.js";

export type SinkOptions = { scenariosDir: string; attackerIp: string };

function send(
  res: ServerResponse,
  status: number,
  body: string,
  type = "application/json",
): void {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function srcIp(req: IncomingMessage): string {
  return (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  store: HitStore;
  logger: Logger;
  opts: SinkOptions;
};

const ok = (res: ServerResponse): void =>
  send(res, 200, JSON.stringify({ ok: true }));
const notFound = (res: ServerResponse): void =>
  send(res, 404, JSON.stringify({ error: "not found" }));

function record(c: Ctx, event: string, fields: Record<string, unknown>): void {
  c.store.add(event, fields);
  c.logger.info({ event, ...fields }, `Receiving ${event} succeeded.`);
}

async function upload(c: Ctx): Promise<void> {
  const body = await readBody(c.req);
  const sha256 = createHash("sha256").update(body).digest("hex");
  record(c, "exfil", { bytes: body.length, srcIp: srcIp(c.req), sha256 });
  ok(c.res);
}

function beacon(c: Ctx): void {
  record(c, "beacon", {
    srcIp: srcIp(c.req),
    id: c.url.searchParams.get("id"),
  });
  ok(c.res);
}

function hits(c: Ctx): void {
  const since = Number(c.url.searchParams.get("since") ?? 0) || 0;
  send(c.res, 200, JSON.stringify(c.store.since(since)));
}

async function stage(c: Ctx): Promise<void> {
  const scenario = c.url.pathname.slice("/stage/".length);
  const script = await loadStage(
    c.logger,
    c.opts.scenariosDir,
    scenario,
    c.opts.attackerIp,
  );
  if (script === null) return notFound(c.res);
  send(c.res, 200, script, "text/x-shellscript");
}

async function route(c: Ctx): Promise<void> {
  const { pathname } = c.url;
  if (c.req.method === "POST" && pathname === "/upload") return upload(c);
  if (pathname === "/beacon") return beacon(c);
  if (pathname === "/hits") return hits(c);
  if (pathname.startsWith("/stage/")) return stage(c);
  notFound(c.res);
}

/** One handler serves both the :8080 sinks and the :8443 beacon listener. */
export function createSinkServer(logger: Logger, opts: SinkOptions): Server {
  const store = new HitStore();
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://sink");
    try {
      await route({ req, res, url, store, logger, opts });
    } catch (err) {
      logger.error({ err, path: url.pathname }, "Handling request failed.");
      send(res, 500, JSON.stringify({ error: "internal" }));
    }
  });
}
