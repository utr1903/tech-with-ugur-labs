import { describe, expect, it } from "vitest";
import { isBlocked, parseBlocklist } from "./blocklist.js";

const HOSTS = `# threat-intel snapshot
0.0.0.0 cdn-metrics.tracklab.lab
0.0.0.0   telemetry.adnexus.lab
0.0.0.0 pin.evil-c2.lab

127.0.0.1 malware-placeholder-1.invalid
`;

describe("parseBlocklist", () => {
  it("collects the hostnames, skipping comments and blanks", () => {
    const set = parseBlocklist(HOSTS);
    expect(set.has("cdn-metrics.tracklab.lab")).toBe(true);
    expect(set.has("telemetry.adnexus.lab")).toBe(true);
    expect(set.has("pin.evil-c2.lab")).toBe(true);
    expect(set.has("malware-placeholder-1.invalid")).toBe(true);
    expect(set.has("0.0.0.0")).toBe(false);
  });

  it("isBlocked is case-insensitive and exact", () => {
    const set = parseBlocklist(HOSTS);
    expect(isBlocked("CDN-Metrics.TrackLab.lab", set)).toBe(true);
    expect(isBlocked("updates.goodvendor.lab", set)).toBe(false);
  });
});
