import { argsByName, type TraceeEvent } from "./events.js";

export type DnsAnswer = { fqdn: string; ip: string; timestamp: number };

type ProtoDns = {
  QR?: number;
  questions?: { name: string; type: string }[];
  answers?: { name: string; type: string; IP: string }[];
};

export function dnsAnswers(events: TraceeEvent[]): DnsAnswer[] {
  const out: DnsAnswer[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (e.eventName !== "net_packet_dns") continue;
    const proto = argsByName(e).proto_dns as ProtoDns | undefined;
    if (!proto || proto.QR !== 1 || !proto.answers) continue;
    const qname = proto.questions?.[0]?.name;
    for (const ans of proto.answers) {
      if (ans.type !== "A" || !ans.IP) continue;
      const fqdn = (qname ?? ans.name).toLowerCase();
      // Tracee emits the same DNS packet more than once; dedupe by fqdn+ip+ts.
      const key = `${fqdn}|${ans.IP}|${e.timestamp}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ fqdn, ip: ans.IP, timestamp: e.timestamp });
    }
  }
  return out;
}

export function fqdnForIp(ip: string, at: number, answers: DnsAnswer[]): string | null {
  let best: DnsAnswer | null = null;
  for (const a of answers) {
    if (a.ip !== ip) continue;
    if (a.timestamp <= at && (!best || a.timestamp > best.timestamp)) best = a;
  }
  if (best) return best.fqdn;
  const any = answers.find((a) => a.ip === ip);
  return any ? any.fqdn : null;
}
