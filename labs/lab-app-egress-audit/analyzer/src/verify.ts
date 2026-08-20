import type { Report } from "./report.js";

const CANARY = "FAKE-FP-000-lab-only";
const BEACONS = ["cdn-metrics.tracklab.lab", "telemetry.adnexus.lab"];
const PINNED = "pin.evil-c2.lab";
const VENDOR = "updates.goodvendor.lab";
const SEEDED = new Set([...BEACONS, PINNED]);

// The e2e gate's assertions. Encodes the expected outcome of the lab so
// `./e2e.sh` fails loudly if interception, decryption, pin detection or
// blocklist matching regresses.
export function verifyReport(report: Report): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const by = (f: string) => report.domains.find((d) => d.fqdn === f);

  // 1. Both beacons decrypted with the canary payload.
  for (const b of BEACONS) {
    const d = by(b);
    if (!d) failures.push(`beacon ${b} missing from report`);
    else if (d.evidenceLayer !== "decrypted HTTP") failures.push(`beacon ${b} not decrypted`);
    else if (!d.payload?.includes(CANARY)) failures.push(`beacon ${b} payload lacks the canary`);
    if (d && d.verdict !== "malicious") failures.push(`beacon ${b} not flagged malicious`);
  }

  // 2. Pinned host is opaque, SNI-only, flagged.
  const pin = by(PINNED);
  if (!pin) failures.push(`pinned host ${PINNED} missing`);
  else {
    if (pin.evidenceLayer !== "SNI-only") failures.push("pinned host not SNI-only");
    if (!pin.opaque) failures.push("pinned host not marked opaque");
    if (pin.verdict !== "malicious") failures.push("pinned host not flagged malicious");
  }

  // 3. Vendor observed and clean.
  const vendor = by(VENDOR);
  if (!vendor) failures.push(`vendor ${VENDOR} missing`);
  else if (vendor.verdict !== "clean") failures.push(`vendor ${VENDOR} wrongly flagged`);

  // 4. No malicious verdict outside the seeded set.
  for (const d of report.domains) {
    if (d.verdict === "malicious" && !SEEDED.has(d.fqdn)) {
      failures.push(`false positive: ${d.fqdn}`);
    }
  }

  return { ok: failures.length === 0, failures };
}
