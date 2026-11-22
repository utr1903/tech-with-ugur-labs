import type { RequestHandler } from "express";

export function log(msg: string, fields: object = {}): void {
  process.stdout.write(JSON.stringify({ time: new Date().toISOString(), msg, ...fields }) + "\n");
}

export const requestLogger: RequestHandler = (req, _res, next) => {
  // INSECURE-BY-DESIGN: logs full request headers and body (passwords, chat content, PII) to stdout
  log("request", { method: req.method, url: req.url, headers: req.headers, body: req.body });
  next();
};
