export type TraceeArg = { name: string; value: unknown };

export type TraceeEvent = {
  eventName: string;
  processId: number;
  parentProcessId: number;
  processName: string;
  hostProcessId: number;
  timestamp: number;
  args: TraceeArg[];
};

export function parseEvents(jsonl: string): TraceeEvent[] {
  const out: TraceeEvent[] = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    // Tracee interleaves its own operational logs (a top-level `level`, no
    // `eventName`) on stdout; those are not trace events.
    if (typeof obj.eventName !== "string") continue;
    out.push({
      eventName: obj.eventName as string,
      processId: Number(obj.processId ?? 0),
      parentProcessId: Number(obj.parentProcessId ?? 0),
      processName: String(obj.processName ?? ""),
      hostProcessId: Number(obj.hostProcessId ?? 0),
      timestamp: Number(obj.timestamp ?? 0),
      args: Array.isArray(obj.args) ? (obj.args as TraceeArg[]) : [],
    });
  }
  return out;
}

export function argsByName(event: TraceeEvent): Record<string, unknown> {
  const rec: Record<string, unknown> = {};
  for (const a of event.args) rec[a.name] = a.value;
  return rec;
}
