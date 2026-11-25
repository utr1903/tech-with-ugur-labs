import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";

const PREVIEW_BYTES = 4096;
export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadSummary = {
  bytes: number;
  sha256: string;
  lineCount: number;
  preview: string;
};

/**
 * Streams the request body, hashing and counting as it goes, so memory use
 * stays flat. Only the first PREVIEW_BYTES are kept. Returns null when the
 * body exceeds maxBytes (the caller answers 413 and records nothing).
 */
export async function summarizeUpload(
  req: IncomingMessage,
  maxBytes: number,
): Promise<UploadSummary | null> {
  const hash = createHash("sha256");
  const head: Buffer[] = [];
  let headLen = 0;
  let bytes = 0;
  let newlines = 0;
  let lastByte = 0;
  for await (const raw of req) {
    const chunk = raw as Buffer;
    bytes += chunk.length;
    // Keep draining (without storing) rather than breaking out: leaving a
    // for-await early destroys the socket and the client never sees the 413.
    if (bytes > maxBytes) continue;
    hash.update(chunk);
    for (const b of chunk) if (b === 10) newlines++;
    lastByte = chunk[chunk.length - 1] ?? lastByte;
    if (headLen < PREVIEW_BYTES) {
      const part = chunk.subarray(0, PREVIEW_BYTES - headLen);
      head.push(part);
      headLen += part.length;
    }
  }
  if (bytes > maxBytes) return null;
  const lineCount = bytes === 0 ? 0 : newlines + (lastByte === 10 ? 0 : 1);
  return {
    bytes,
    sha256: hash.digest("hex"),
    lineCount,
    preview: Buffer.concat(head).toString("utf8"),
  };
}
