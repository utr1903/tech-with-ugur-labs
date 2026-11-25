import { exec } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { promisify } from "node:util";
import type { Logger } from "../logger.js";
import { runPreview } from "./preview.js";
import { PRODUCTS } from "./products.js";
import { toRequestLogFields } from "./request-log.js";

const execAsync = promisify(exec);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function startStorefrontServer(logger: Logger, port: number): void {
  const httpLogger = logger.child({ domain: "http" });
  const server = createServer(async (req, res) => {
    const started = Date.now();
    const fields = toRequestLogFields(req);
    res.on("finish", () => {
      httpLogger.info(
        { ...fields, status: res.statusCode, durationMs: Date.now() - started },
        "Handling request succeeded.",
      );
    });
    try {
      if (fields.path === "/healthz") return sendJson(res, 200, { ok: true });
      if (fields.path === "/products") return sendJson(res, 200, PRODUCTS);
      if (fields.path === "/preview") {
        const url = new URLSearchParams(fields.query).get("url") ?? "";
        return sendJson(res, 200, await runPreview(logger, url, execAsync));
      }
      return sendJson(res, 404, { error: "not found" });
    } catch (err) {
      logger.error({ err, path: fields.path }, "Handling request failed.");
      return sendJson(res, 502, { error: "preview failed" });
    }
  });
  server.listen(port, () =>
    logger.info({ port }, "Starting storefront succeeded."),
  );
}
