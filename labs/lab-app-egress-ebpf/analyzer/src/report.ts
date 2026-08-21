import { attribute } from "./attribute.js";
import type { TraceeEvent } from "./events.js";

export type Verdict = "malicious" | "clean";

export type Row = {
  fqdn: string;
  ips: string[];
  verdict: Verdict;
  process: { pid: number; comm: string; path: string } | null;
  lineage: { pid: number; comm: string; path: string; argv: string[] }[];
};

export type Report = { rows: Row[] };

export function buildReport(events: TraceeEvent[], blocklist: Set<string>): Report {
  const rows: Row[] = attribute(events).map((a) => ({
    fqdn: a.fqdn,
    ips: a.ips,
    verdict: blocklist.has(a.fqdn.toLowerCase()) ? "malicious" : "clean",
    process: a.process
      ? { pid: a.process.pid, comm: a.process.comm, path: a.process.path }
      : null,
    lineage: a.lineage.map((p) => ({ pid: p.pid, comm: p.comm, path: p.path, argv: p.argv })),
  }));
  rows.sort((x, y) => x.fqdn.localeCompare(y.fqdn));
  return { rows };
}

export function renderTable(report: Report): string {
  const header = "| FQDN | Verdict | Process | Lineage |\n|---|---|---|---|";
  const body = report.rows
    .map((r) => {
      const proc = r.process ? `${r.process.comm} (${r.process.path})` : "unknown";
      const chain = r.lineage.map((p) => p.comm).join(" ← ") || "unknown";
      return `| ${r.fqdn} | ${r.verdict} | ${proc} | ${chain} |`;
    })
    .join("\n");
  return `${header}\n${body}`;
}
