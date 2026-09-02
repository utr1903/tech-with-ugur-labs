export type PlanEntry = { url: string; everyMs: number };

function parseEntry(raw: string): PlanEntry {
  const at = raw.lastIndexOf("@");
  if (at === -1) {
    throw new Error(
      `Request plan entries must look like "url@interval" (got "${raw}").`,
    );
  }
  const url = raw.slice(0, at).trim();
  const everyMs = Number(raw.slice(at + 1).trim());
  if (!url.startsWith("http://")) {
    throw new Error(`Request plan entries must use plain http (got "${url}").`);
  }
  if (!Number.isInteger(everyMs) || everyMs <= 0) {
    throw new Error(
      `Request plan intervals must be a positive number of milliseconds (got "${raw}").`,
    );
  }
  return { url, everyMs };
}

export function parsePlan(spec: string): PlanEntry[] {
  const entries = spec
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(parseEntry);
  if (entries.length === 0) {
    throw new Error("A request plan needs at least one entry.");
  }
  return entries;
}
