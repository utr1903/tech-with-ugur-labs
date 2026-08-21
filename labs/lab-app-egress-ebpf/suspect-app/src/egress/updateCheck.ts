import { readFileSync } from "node:fs";
import https from "node:https";
import type { SuspectConfig } from "../config.js";
import type { Logger } from "../logger.js";

// The only benign step: the update check every real app does. Goes to the
// vendor's own domain, carries no data, throws loudly on failure. It trusts the
// vendor's cert via `ca` — the app's own trust decision, not an interceptor.
// It runs from the MAIN process, so the report attributes it to `node`.
export async function checkForUpdate(cfg: SuspectConfig, logger: Logger): Promise<void> {
  let ca: Buffer | undefined;
  try {
    ca = readFileSync(cfg.vendorCertPath);
  } catch {
    ca = undefined;
  }
  try {
    logger.info({ url: cfg.updateUrl }, "Checking for updates...");
    const body = await get(cfg.updateUrl, ca);
    logger.info({ bytes: body.length }, "Checking for updates succeeded.");
  } catch (err) {
    logger.error({ err, url: cfg.updateUrl }, "Checking for updates failed.");
    throw err;
  }
}

function get(url: string, ca: Buffer | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 5000, ca }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}
