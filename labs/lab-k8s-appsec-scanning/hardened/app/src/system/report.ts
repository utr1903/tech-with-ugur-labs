import { times } from "lodash";

const CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_REPORT_ROWS = 4;

// Hardened: the caller-controlled size is clamped to a small ceiling BEFORE any
// allocation, so no single request can exhaust the container's memory.
export function buildReport(rows: number): { bytes: number } {
  const safe = Math.max(0, Math.min(Math.floor(rows) || 0, MAX_REPORT_ROWS));
  const retained: Buffer[] = times(safe, () => Buffer.alloc(CHUNK_BYTES, 1));
  return { bytes: retained.length * CHUNK_BYTES };
}
