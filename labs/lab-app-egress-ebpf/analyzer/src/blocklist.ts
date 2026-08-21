export function parseBlocklist(text: string): Set<string> {
  const set = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    const host = parts.length >= 2 ? parts[1] : parts[0];
    if (host) set.add(host.toLowerCase());
  }
  return set;
}
