import { describe, expect, it } from "vitest";
import type { HostEvidence } from "./capture.js";
import { buildReport, renderTable } from "./report.js";

function ev(p: Partial<HostEvidence>): HostEvidence {
  return { decrypted: false, sniSeen: false, tlsFailed: false, ...p };
}

const blocklist = new Set(["cdn-metrics.tracklab.lab", "pin.evil-c2.lab"]);
const dns = ["updates.goodvendor.lab", "cdn-metrics.tracklab.lab", "pin.evil-c2.lab"];
const evidence = new Map<string, HostEvidence>([
  ["updates.goodvendor.lab", ev({ decrypted: true, sniSeen: true })],
  ["cdn-metrics.tracklab.lab", ev({ decrypted: true, sniSeen: true, payload: "FAKE-FP-000-lab-only" })],
  ["pin.evil-c2.lab", ev({ sniSeen: true, tlsFailed: true })],
]);

describe("buildReport", () => {
  const report = buildReport(dns, evidence, blocklist);
  const by = (f: string) => report.domains.find((d) => d.fqdn === f);

  it("flags a decrypted beacon with its payload", () => {
    expect(by("cdn-metrics.tracklab.lab")).toMatchObject({
      verdict: "malicious",
      evidenceLayer: "decrypted HTTP",
      opaque: false,
      payload: "FAKE-FP-000-lab-only",
    });
  });

  it("flags the pinned host as opaque, SNI-only", () => {
    expect(by("pin.evil-c2.lab")).toMatchObject({
      verdict: "malicious",
      evidenceLayer: "SNI-only",
      opaque: true,
    });
  });

  it("reports the vendor as observed and clean", () => {
    expect(by("updates.goodvendor.lab")).toMatchObject({
      verdict: "clean",
      evidenceLayer: "decrypted HTTP",
    });
  });

  it("includes a DNS-only host when seen only in DNS", () => {
    const r = buildReport([...dns, "orphan.lab"], evidence, blocklist);
    expect(r.domains.find((d) => d.fqdn === "orphan.lab")).toMatchObject({
      evidenceLayer: "DNS-only",
      verdict: "clean",
    });
  });
});

describe("renderTable", () => {
  it("names every observed FQDN", () => {
    const table = renderTable(buildReport(dns, evidence, blocklist));
    for (const f of dns) expect(table).toContain(f);
  });
});
