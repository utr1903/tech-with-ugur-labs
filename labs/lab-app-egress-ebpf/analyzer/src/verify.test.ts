import { describe, expect, it } from "vitest";
import type { Report } from "./report.js";
import { verifyReport } from "./verify.js";

const goodReport: Report = {
  rows: [
    { fqdn: "updates.goodvendor.lab", ips: ["10.10.0.10"], verdict: "clean",
      process: { pid: 1, comm: "node", path: "/usr/local/bin/node" },
      lineage: [{ pid: 1, comm: "node", path: "/usr/local/bin/node", argv: ["node"] }] },
    { fqdn: "cdn-metrics.tracklab.lab", ips: ["10.10.0.11"], verdict: "malicious",
      process: { pid: 7, comm: "sys-helper", path: "/app/bin/sys-helper" },
      lineage: [
        { pid: 7, comm: "sys-helper", path: "/app/bin/sys-helper", argv: ["sys-helper"] },
        { pid: 1, comm: "node", path: "/usr/local/bin/node", argv: ["node"] },
      ] },
    { fqdn: "telemetry.adnexus.lab", ips: ["10.10.0.12"], verdict: "malicious",
      process: { pid: 7, comm: "sys-helper", path: "/app/bin/sys-helper" },
      lineage: [
        { pid: 7, comm: "sys-helper", path: "/app/bin/sys-helper", argv: ["sys-helper"] },
        { pid: 1, comm: "node", path: "/usr/local/bin/node", argv: ["node"] },
      ] },
  ],
};

const cleanCompose = { services: { "suspect-app": { environment: { LOG_LEVEL: "info" } } } };

describe("verifyReport", () => {
  it("passes on the expected report and a clean suspect-app service", () => {
    expect(verifyReport(goodReport, cleanCompose).ok).toBe(true);
  });

  it("fails when a beacon is not attributed to the helper", () => {
    const r = structuredClone(goodReport);
    r.rows[1].process = { pid: 1, comm: "node", path: "/usr/local/bin/node" };
    expect(verifyReport(r, cleanCompose).ok).toBe(false);
  });

  it("fails when the suspect-app service carries a proxy/CA env var", () => {
    const compose = { services: { "suspect-app": { environment: { HTTPS_PROXY: "http://x" } } } };
    expect(verifyReport(goodReport, compose).ok).toBe(false);
  });

  it("fails when the suspect-app service is privileged or adds caps", () => {
    const compose = { services: { "suspect-app": { privileged: true } } };
    expect(verifyReport(goodReport, compose).ok).toBe(false);
  });

  it("fails on a false positive outside the seeded set", () => {
    const r = structuredClone(goodReport);
    r.rows.push({ fqdn: "extra.lab", ips: ["10.10.0.99"], verdict: "malicious", process: null, lineage: [] });
    expect(verifyReport(r, cleanCompose).ok).toBe(false);
  });
});
