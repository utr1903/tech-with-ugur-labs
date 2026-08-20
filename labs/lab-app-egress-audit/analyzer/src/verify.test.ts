import { describe, expect, it } from "vitest";
import type { Report } from "./report.js";
import { verifyReport } from "./verify.js";

const good: Report = {
  generatedAt: "t",
  domains: [
    { fqdn: "updates.goodvendor.lab", verdict: "clean", evidenceLayer: "decrypted HTTP", opaque: false },
    { fqdn: "cdn-metrics.tracklab.lab", verdict: "malicious", evidenceLayer: "decrypted HTTP", opaque: false, payload: '{"fingerprint":"FAKE-FP-000-lab-only"}' },
    { fqdn: "telemetry.adnexus.lab", verdict: "malicious", evidenceLayer: "decrypted HTTP", opaque: false, payload: '{"fingerprint":"FAKE-FP-000-lab-only"}' },
    { fqdn: "pin.evil-c2.lab", verdict: "malicious", evidenceLayer: "SNI-only", opaque: true },
  ],
};

describe("verifyReport", () => {
  it("passes on the expected report", () => {
    expect(verifyReport(good)).toEqual({ ok: true, failures: [] });
  });

  it("fails if a beacon is not decrypted", () => {
    const bad = structuredClone(good);
    bad.domains[1].evidenceLayer = "SNI-only";
    expect(verifyReport(bad).ok).toBe(false);
  });

  it("fails if the canary is missing from a beacon payload", () => {
    const bad = structuredClone(good);
    bad.domains[1].payload = "{}";
    expect(verifyReport(bad).ok).toBe(false);
  });

  it("fails if the pinned host is not opaque SNI-only", () => {
    const bad = structuredClone(good);
    bad.domains[3].opaque = false;
    expect(verifyReport(bad).ok).toBe(false);
  });

  it("fails on a false positive outside the seeded set", () => {
    const bad = structuredClone(good);
    bad.domains.push({ fqdn: "updates.goodvendor.lab.extra", verdict: "malicious", evidenceLayer: "DNS-only", opaque: false });
    expect(verifyReport(bad).ok).toBe(false);
  });
});
