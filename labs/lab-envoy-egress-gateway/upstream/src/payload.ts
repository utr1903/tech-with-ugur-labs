// Every destination answers with a body of exactly its configured size. Fixed
// sizes are what make the gateway's per-destination byte counters and body-size
// histogram buckets predictable enough to assert on.
export function buildPayload(bytes: number): Buffer {
  if (!Number.isInteger(bytes) || bytes <= 0) {
    throw new Error(
      `Payload size must be a positive integer (got ${String(bytes)}).`,
    );
  }
  return Buffer.alloc(bytes, "x");
}
