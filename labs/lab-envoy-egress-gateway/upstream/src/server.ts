import http from "node:http";
import type { UpstreamConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { buildPayload } from "./payload.js";

export function createServer(cfg: UpstreamConfig, logger: Logger): http.Server {
  const payload = buildPayload(cfg.payloadBytes);
  const destinationLogger = logger.child({ destination: cfg.destinationName });

  return http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    try {
      destinationLogger.info(
        { path: req.url },
        "Serving a destination response...",
      );
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(payload.length),
      });
      res.end(payload);
      destinationLogger.info(
        { path: req.url, bytes: payload.length },
        "Serving a destination response succeeded.",
      );
    } catch (err) {
      destinationLogger.error(
        { err, path: req.url },
        "Serving a destination response failed.",
      );
      throw err;
    }
  });
}
