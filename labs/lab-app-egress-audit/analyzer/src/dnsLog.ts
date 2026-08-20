// The DNS evidence layer. Extract every distinct FQDN the app looked up from
// dnsmasq's `log-queries` output. Query lines look like:
//   Aug 20 10:15:02 dnsmasq[1]: query[A] updates.goodvendor.lab from 10.10.0.2
// (the source IP is the gateway's, since the app shares its network namespace).
// Answer lines ("config ... is 10.10.0.10") don't match and are ignored.
const QUERY = /query\[[A-Z0-9]+\]\s+(\S+)\s+from\b/;

export function parseDnsQueries(logText: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of logText.split("\n")) {
    const m = QUERY.exec(line);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}
