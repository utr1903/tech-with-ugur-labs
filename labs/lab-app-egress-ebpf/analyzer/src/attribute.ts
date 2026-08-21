import { dnsAnswers, fqdnForIp } from "./dnsAnswers.js";
import { argsByName, type TraceeEvent } from "./events.js";
import { buildProcessTable, lineage, type Proc } from "./processTable.js";

export type Connect = { ip: string; port: number; pid: number; timestamp: number };

type SockAddr = { sa_family?: string; sin_addr?: string; sin_port?: string };

export function tcpConnects(events: TraceeEvent[]): Connect[] {
  const out: Connect[] = [];
  for (const e of events) {
    if (e.eventName !== "security_socket_connect") continue;
    const a = argsByName(e);
    if (a.type !== "SOCK_STREAM") continue;
    const addr = a.remote_addr as SockAddr | undefined;
    if (!addr || addr.sa_family !== "AF_INET" || !addr.sin_addr) continue;
    out.push({
      ip: addr.sin_addr,
      port: Number(addr.sin_port ?? 0),
      pid: e.processId,
      timestamp: e.timestamp,
    });
  }
  return out;
}

export type Attribution = {
  fqdn: string;
  ips: string[];
  pid: number;
  process: Proc | null;
  lineage: Proc[];
};

export function attribute(events: TraceeEvent[]): Attribution[] {
  const answers = dnsAnswers(events);
  const table = buildProcessTable(events);
  const groups = new Map<string, Attribution>();
  for (const c of tcpConnects(events)) {
    const fqdn = fqdnForIp(c.ip, c.timestamp, answers) ?? c.ip;
    let group = groups.get(fqdn);
    if (!group) {
      const proc = table.get(c.pid) ?? null;
      group = { fqdn, ips: [], pid: c.pid, process: proc, lineage: lineage(c.pid, table) };
      groups.set(fqdn, group);
    }
    if (!group.ips.includes(c.ip)) group.ips.push(c.ip);
  }
  return [...groups.values()];
}
