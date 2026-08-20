import { describe, expect, it } from "vitest";
import { parseDnsQueries } from "./dnsLog.js";

const SAMPLE = `Aug 20 12:00:01 dnsmasq[1]: query[A] updates.goodvendor.lab from 10.10.1.10
Aug 20 12:00:01 dnsmasq[1]: config updates.goodvendor.lab is 10.10.2.10
Aug 20 12:00:02 dnsmasq[1]: query[AAAA] cdn-metrics.tracklab.lab from 10.10.1.10
Aug 20 12:00:02 dnsmasq[1]: query[A] cdn-metrics.tracklab.lab from 10.10.1.10
Aug 20 12:00:03 dnsmasq[1]: query[A] pin.evil-c2.lab from 10.10.1.10`;

describe("parseDnsQueries", () => {
  it("extracts unique FQDNs from query lines in first-seen order", () => {
    expect(parseDnsQueries(SAMPLE)).toEqual([
      "updates.goodvendor.lab",
      "cdn-metrics.tracklab.lab",
      "pin.evil-c2.lab",
    ]);
  });

  it("ignores non-query lines and returns [] for empty input", () => {
    expect(parseDnsQueries("")).toEqual([]);
    expect(parseDnsQueries("Aug 20 dnsmasq[1]: read /etc/hosts")).toEqual([]);
  });
});
