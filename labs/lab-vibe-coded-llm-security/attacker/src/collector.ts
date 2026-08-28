import http from "node:http";
import { appendEvidence } from "./evidence.js";
import type { Logger } from "./logger.js";

export function createCollector(deps: {
  logger: Logger;
  evidenceFile: string;
}): http.Server {
  const { logger, evidenceFile } = deps;

  return http.createServer((req, res) => {
    logger.info("Collecting exfil request...");

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      appendEvidence(evidenceFile, `${req.method} ${req.url} ${body}`);
      res.writeHead(200);
      res.end("ok");
    });
  });
}
