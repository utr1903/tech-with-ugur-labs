// Extract the queried FQDNs from a dnsmasq query log. Lines look like:
//   <ts> dnsmasq[1]: query[A] updates.goodvendor.lab from 10.10.1.10
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
