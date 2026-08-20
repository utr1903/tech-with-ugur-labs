export type HostEvidence = {
  decrypted: boolean;
  sniSeen: boolean;
  tlsFailed: boolean;
  payload?: string;
};

type Row =
  | { event: "clienthello"; sni: string | null }
  | { event: "request"; host: string; method: string; path: string; body: string | null }
  | { event: "tls_failed_client"; sni: string | null };

function ensure(map: Map<string, HostEvidence>, fqdn: string): HostEvidence {
  let ev = map.get(fqdn);
  if (!ev) {
    ev = { decrypted: false, sniSeen: false, tlsFailed: false };
    map.set(fqdn, ev);
  }
  return ev;
}

export function parseCapture(jsonl: string): Map<string, HostEvidence> {
  const map = new Map<string, HostEvidence>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as Row;
    if (row.event === "clienthello" && row.sni) {
      ensure(map, row.sni).sniSeen = true;
    } else if (row.event === "request") {
      const ev = ensure(map, row.host);
      ev.decrypted = true;
      ev.sniSeen = true;
      if (row.body) ev.payload = row.body;
    } else if (row.event === "tls_failed_client" && row.sni) {
      ensure(map, row.sni).tlsFailed = true;
    }
  }
  return map;
}
