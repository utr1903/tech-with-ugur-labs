import { argsByName, type TraceeEvent } from "./events.js";

export type Proc = {
  pid: number;
  ppid: number;
  comm: string;
  path: string;
  argv: string[];
};

export function buildProcessTable(events: TraceeEvent[]): Map<number, Proc> {
  const table = new Map<number, Proc>();
  for (const e of events) {
    if (e.processId <= 0) continue;
    const existing = table.get(e.processId);
    if (e.eventName === "sched_process_exec") {
      const a = argsByName(e);
      table.set(e.processId, {
        pid: e.processId,
        ppid: e.parentProcessId,
        comm: e.processName,
        path: String(a.pathname ?? a.cmdpath ?? ""),
        argv: Array.isArray(a.argv) ? (a.argv as string[]) : [],
      });
    } else if (!existing) {
      table.set(e.processId, {
        pid: e.processId,
        ppid: e.parentProcessId,
        comm: e.processName,
        path: "",
        argv: [],
      });
    }
  }
  return table;
}

export function lineage(pid: number, table: Map<number, Proc>): Proc[] {
  const chain: Proc[] = [];
  const seen = new Set<number>();
  let current = table.get(pid);
  while (current && !seen.has(current.pid)) {
    chain.push(current);
    seen.add(current.pid);
    if (current.pid === 1 || current.ppid <= 0) break;
    current = table.get(current.ppid);
  }
  return chain;
}
