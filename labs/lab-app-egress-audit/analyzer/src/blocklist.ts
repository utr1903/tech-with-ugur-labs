// Parse a hosts-format blocklist (`<ip> <hostname>` per line, `#` comments).
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
