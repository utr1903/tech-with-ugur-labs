import { times } from "lodash";

const CHUNK_BYTES = 8 * 1024 * 1024;

// DELIBERATELY VULNERABLE: the caller-controlled `rows` drives an unbounded,
// retained, off-heap allocation. Each chunk is filled (not left as unfaulted
// virtual memory), so every page is actually committed and container RSS grows
// until the cgroup memory limit trips and the kernel OOM-kills the process — a
// one-request DoS. A real endpoint would cap `rows` and stream results.
export function buildReport(rows: number): { bytes: number } {
  const retained: Buffer[] = times(rows, () => Buffer.alloc(CHUNK_BYTES, 1));
  return { bytes: retained.length * CHUNK_BYTES };
}
