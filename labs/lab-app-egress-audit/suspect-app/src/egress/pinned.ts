import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import https from "node:https";
import type { SuspectConfig } from "../config.js";
import type { Logger } from "../logger.js";

// Compute the SHA-256 fingerprint of a PEM leaf cert in Node's
// `fingerprint256` shape: uppercase hex, colon-separated byte pairs.
export function fingerprint256(pem: string): string {
  const base64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");
  const der = Buffer.from(base64, "base64");
  const hex = createHash("sha256").update(der).digest("hex").toUpperCase();
  return (hex.match(/../g) ?? []).join(":");
}

// SUSPICIOUS STEP 4 of 4: the certificate-pinned C2 check-in.
//
// Certificate pinning: accept the connection only if the presented leaf cert's
// SHA-256 fingerprint equals the one we expect (the webhost's real cert, read
// from the shared volume). Node calls this callback during the TLS handshake
// with whatever certificate the server presented; returning an Error aborts the
// handshake before a single byte of HTTP is sent.
//
// Under interception the "server" is mitmproxy presenting a forged cert signed
// by its own CA. The chain would validate (the CA is trusted), but the
// fingerprint differs, so the pin fails. Malware pins precisely so defenders
// cannot read its C2 traffic — and that refusal is the opaque signal the
// gateway records as `tls_failed_client`.
export function makeServerIdentityCheck(
  expectedFingerprint: string,
): (host: string, cert: { fingerprint256?: string }) => Error | undefined {
  return (_host, cert) => {
    if (cert.fingerprint256 && cert.fingerprint256 === expectedFingerprint) {
      return undefined;
    }
    return new Error(
      `certificate pin mismatch: expected ${expectedFingerprint}, got ${cert.fingerprint256 ?? "none"}`,
    );
  };
}

export async function pinnedCheckin(cfg: SuspectConfig, logger: Logger): Promise<void> {
  const expected = fingerprint256(readFileSync(cfg.pinnedCertPath, "utf8"));
  const check = makeServerIdentityCheck(expected);
  try {
    logger.info({ url: cfg.pinnedUrl }, "Opening pinned connection...");
    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        cfg.pinnedUrl,
        { method: "POST", checkServerIdentity: check, timeout: 5000 },
        (res) => {
          res.on("data", () => {});
          res.on("end", () => resolve());
        },
      );
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.end("{}");
    });
    logger.warn({ url: cfg.pinnedUrl }, "Pinned connection succeeded (no interception).");
  } catch (err) {
    // A real pinned C2 client stays quiet when it cannot verify its server:
    // from the malware's point of view, a failed pin means "someone is
    // watching", so it backs off rather than reveal itself. (Hence success is
    // logged at `warn` above and failure at `info` here.)
    logger.info({ err, url: cfg.pinnedUrl }, "Pinned connection refused the presented certificate.");
  }
}
