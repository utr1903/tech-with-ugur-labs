/**
 * Reads a transcript file whole (replay, verify) or follows it while the
 * agent is still writing it (live view). Following polls the file size and
 * keeps an incomplete last line until its newline arrives. Bytes are
 * decoded with a streaming TextDecoder so a multi-byte UTF-8 character
 * split across two reads is never corrupted into replacement characters.
 */
import { open, readFile, stat } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { TranscriptEvent } from "./events.js";
import { parseLine } from "./parse.js";

/** Reads a finished transcript file and parses every line. */
export async function readTranscript(path: string): Promise<TranscriptEvent[]> {
  const text = await readFile(path, "utf8");
  return text
    .split("\n")
    .map(parseLine)
    .filter((e): e is TranscriptEvent => e !== null);
}

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

async function readRange(
  path: string,
  start: number,
  end: number,
): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(end - start);
    await handle.read(buffer, 0, buffer.length, start);
    return buffer;
  } finally {
    await handle.close();
  }
}

interface FollowState {
  offset: number;
  pending: string;
}

/**
 * Reads and decodes whatever has been appended to `path` since `state.offset`,
 * splits it into complete lines, and yields the parsed event of each one.
 * Any trailing partial line is kept in `state.pending` for the next call.
 * Returns whether new bytes were read, so the caller can decide to poll again.
 */
async function* drainNewLines(
  path: string,
  state: FollowState,
  decoder: InstanceType<typeof TextDecoder>,
): AsyncGenerator<TranscriptEvent, boolean> {
  const size = await sizeOf(path);
  if (size === null || size <= state.offset) return false;
  state.pending += decoder.decode(await readRange(path, state.offset, size), {
    stream: true,
  });
  state.offset = size;
  const lines = state.pending.split("\n");
  state.pending = lines.pop() ?? "";
  for (const line of lines) {
    const event = parseLine(line);
    if (event) yield event;
  }
  return true;
}

/**
 * Yields transcript events as they are appended to `path`, waiting for the
 * file to exist and polling its size every `pollMs`. `isFinished` is
 * checked before the read on every iteration so the final bytes written
 * right before the run ends are still read.
 */
export async function* followTranscript(
  path: string,
  isFinished: () => Promise<boolean>,
  pollMs = 250,
): AsyncGenerator<TranscriptEvent> {
  const decoder = new TextDecoder("utf-8");
  const state: FollowState = { offset: 0, pending: "" };
  for (;;) {
    const finished = await isFinished();
    const gotNewBytes = yield* drainNewLines(path, state, decoder);
    if (gotNewBytes) continue;
    if (!finished) {
      await sleep(pollMs);
      continue;
    }
    state.pending += decoder.decode();
    const last = parseLine(state.pending);
    if (last) yield last;
    return;
  }
}
