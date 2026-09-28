// Pure summary of access-log text: parsing, counting, top paths, p95.
const LINE = /^\S+ \S+ \S+ \[[^\]]*\] "\S+ (\S+) \S+" (\d{3}) (\d+|-) (\d+(?:\.\d+)?)$/;

export interface Summary {
  totalLines: number;
  validRequests: number;
  malformedLines: number;
  statusClasses: Record<"1xx" | "2xx" | "3xx" | "4xx" | "5xx", number>;
  topPaths: { path: string; count: number }[];
  p95LatencyMs: number | null;
}

interface Request {
  path: string;
  status: number;
  durationMs: number;
}

/** Parses one access-log line into a Request, or null if it is malformed. */
export function parseLine(line: string): Request | null {
  const match = LINE.exec(line);
  if (!match) return null;
  const [, target = "", status = "", , duration = ""] = match;
  const code = Number(status);
  if (code < 100 || code > 599) return null;
  return { path: target.split("?")[0] ?? target, status: code, durationMs: Number(duration) };
}

/** Nearest-rank 95th percentile over a set of values, or null if empty. */
export function nearestRankP95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? null;
}

/** Top 5 request paths by count, ties broken by path ascending. */
function topPaths(requests: Request[]): Summary["topPaths"] {
  const counts = new Map<string, number>();
  for (const r of requests) counts.set(r.path, (counts.get(r.path) ?? 0) + 1);
  return [...counts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, 5);
}

/** Summarizes raw access-log text into the JSON shape the CLI prints. */
export function summarize(text: string): Summary {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const requests = lines.map(parseLine).filter((r): r is Request => r !== null);
  const statusClasses = { "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
  for (const r of requests) {
    const key = `${Math.floor(r.status / 100)}xx` as keyof typeof statusClasses;
    statusClasses[key] += 1;
  }
  return {
    totalLines: lines.length,
    validRequests: requests.length,
    malformedLines: lines.length - requests.length,
    statusClasses,
    topPaths: topPaths(requests),
    p95LatencyMs: nearestRankP95(requests.map((r) => r.durationMs)),
  };
}
