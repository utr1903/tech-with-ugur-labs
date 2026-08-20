import https from "node:https";
import type { SuspectConfig } from "../config.js";
import type { Logger } from "../logger.js";

export async function checkForUpdate(cfg: SuspectConfig, logger: Logger): Promise<void> {
  try {
    logger.info({ url: cfg.updateUrl }, "Checking for updates...");
    const body = await get(cfg.updateUrl);
    logger.info({ bytes: body.length }, "Checking for updates succeeded.");
  } catch (err) {
    logger.error({ err, url: cfg.updateUrl }, "Checking for updates failed.");
    throw err;
  }
}

function get(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 5000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}
