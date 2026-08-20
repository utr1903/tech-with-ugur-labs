import { isBlocked } from "./blocklist.js";
import type { HostEvidence } from "./capture.js";

export type DomainVerdict = {
  fqdn: string;
  verdict: "malicious" | "clean";
  evidenceLayer: "decrypted HTTP" | "SNI-only" | "DNS-only";
  opaque: boolean;
  payload?: string;
};

export type Report = { generatedAt: string; domains: DomainVerdict[] };

// The deepest visibility layer reached for a host: a decrypted request beats
// a bare SNI, which beats a name that was merely looked up in DNS.
function layerOf(ev: HostEvidence | undefined): DomainVerdict["evidenceLayer"] {
  if (ev?.decrypted) return "decrypted HTTP";
  if (ev?.sniSeen) return "SNI-only";
  return "DNS-only";
}

// One row per hostname seen in EITHER the DNS log or the gateway capture.
// The verdict comes purely from the blocklist; the evidence layer and the
// `opaque` flag describe how much of the conversation we could see.
// `opaque` = we saw the SNI, the client then aborted the handshake, and nothing
// was ever decrypted — the signature of certificate pinning.
export function buildReport(
  dnsFqdns: string[],
  evidence: Map<string, HostEvidence>,
  blocklist: Set<string>,
  now: string = new Date().toISOString(),
): Report {
  const fqdns = new Set<string>([...dnsFqdns, ...evidence.keys()]);
  const domains: DomainVerdict[] = [];
  for (const fqdn of fqdns) {
    const ev = evidence.get(fqdn);
    domains.push({
      fqdn,
      verdict: isBlocked(fqdn, blocklist) ? "malicious" : "clean",
      evidenceLayer: layerOf(ev),
      opaque: Boolean(ev && !ev.decrypted && ev.tlsFailed),
      ...(ev?.payload ? { payload: ev.payload } : {}),
    });
  }
  domains.sort((a, b) => a.fqdn.localeCompare(b.fqdn));
  return { generatedAt: now, domains };
}

export function renderTable(report: Report): string {
  const header = ["FQDN", "VERDICT", "EVIDENCE LAYER", "OPAQUE", "PAYLOAD"];
  const rows = report.domains.map((d) => [
    d.fqdn,
    d.verdict,
    d.evidenceLayer,
    d.opaque ? "yes" : "no",
    d.payload ? d.payload.slice(0, 48) : "-",
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const fmt = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [fmt(header), fmt(widths.map((w) => "-".repeat(w))), ...rows.map(fmt)].join("\n");
}
