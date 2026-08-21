import type { Report, Row } from "./report.js";

export type ComposeConfig = { services: Record<string, Record<string, unknown>> };

const MALICIOUS = ["cdn-metrics.tracklab.lab", "telemetry.adnexus.lab"];
const CLEAN = "updates.goodvendor.lab";
const EXPECTED = new Set([...MALICIOUS, CLEAN]);

const FORBIDDEN_ENV = [
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy",
  "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "NODE_TLS_REJECT_UNAUTHORIZED",
];
const FORBIDDEN_KEYS = ["cap_add", "privileged", "network_mode", "extra_hosts", "sysctls"];

function envRecord(service: Record<string, unknown>): Record<string, string> {
  const env = service.environment;
  if (Array.isArray(env)) {
    const rec: Record<string, string> = {};
    for (const item of env) {
      const [k, ...rest] = String(item).split("=");
      rec[k] = rest.join("=");
    }
    return rec;
  }
  if (env && typeof env === "object") {
    return Object.fromEntries(
      Object.entries(env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
    );
  }
  return {};
}

function rowFor(report: Report, fqdn: string): Row | undefined {
  return report.rows.find((r) => r.fqdn === fqdn);
}

export function verifyReport(
  report: Report,
  compose: ComposeConfig,
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // 1. Both beacons malicious and attributed to the helper with node in lineage.
  for (const fqdn of MALICIOUS) {
    const row = rowFor(report, fqdn);
    if (!row) {
      failures.push(`missing row for ${fqdn}`);
      continue;
    }
    if (row.verdict !== "malicious") failures.push(`${fqdn} not flagged malicious`);
    if (row.process?.path !== "/app/bin/sys-helper") {
      failures.push(`${fqdn} not attributed to /app/bin/sys-helper`);
    }
    if (!row.lineage.some((p) => p.comm === "node")) {
      failures.push(`${fqdn} lineage missing the node parent`);
    }
  }

  // 2. Vendor clean, attributed to the main node process (not the helper).
  const good = rowFor(report, CLEAN);
  if (!good) failures.push(`missing row for ${CLEAN}`);
  else {
    if (good.verdict !== "clean") failures.push(`${CLEAN} not clean`);
    if (good.process?.path === "/app/bin/sys-helper") {
      failures.push(`${CLEAN} wrongly attributed to the helper`);
    }
    if (good.process?.comm !== "node") failures.push(`${CLEAN} not attributed to node`);
  }

  // 3. Zero cooperation: the suspect-app service is bare.
  const svc = compose.services["suspect-app"] ?? {};
  const env = envRecord(svc);
  for (const key of FORBIDDEN_ENV) {
    if (key in env) failures.push(`suspect-app carries forbidden env ${key}`);
  }
  for (const key of FORBIDDEN_KEYS) {
    if (key in svc) failures.push(`suspect-app carries forbidden key ${key}`);
  }

  // 4. No false positives outside the seeded set.
  for (const row of report.rows) {
    if (row.verdict === "malicious" && !EXPECTED.has(row.fqdn)) {
      failures.push(`false positive: ${row.fqdn}`);
    }
  }

  return { ok: failures.length === 0, failures };
}
