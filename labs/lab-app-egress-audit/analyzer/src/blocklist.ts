// Parse a threat-intel blocklist in hosts format (`<ip> <hostname>` per line,
// `#` comments, as published by feeds such as URLhaus). Only the hostnames
// matter; the IP column is the sinkhole address and is discarded.
export function parseBlocklist(hostsText: string): Set<string> {
  const set = new Set<string>();
  for (const raw of hostsText.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    for (const host of parts.slice(1)) {
      set.add(host.toLowerCase());
    }
  }
  return set;
}

export function isBlocked(fqdn: string, set: Set<string>): boolean {
  return set.has(fqdn.toLowerCase());
}
