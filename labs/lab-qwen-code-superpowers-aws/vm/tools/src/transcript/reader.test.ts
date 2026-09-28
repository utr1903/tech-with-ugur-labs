import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { followTranscript, readTranscript } from "./reader.js";

const fixture = (name: string) =>
  new URL(`./fixtures/${name}`, import.meta.url).pathname;

describe("readTranscript", () => {
  it("returns every parsed event of a finished transcript", async () => {
    const events = await readTranscript(fixture("tdd-session.jsonl"));
    expect(events.filter((e) => e.kind === "turn-start")).toHaveLength(8);
    expect(events.at(-1)?.kind).toBe("result");
  });
});

describe("followTranscript yields appended lines, including a split line", () => {
  it("yields lines as they are appended, including a split line, until the run finishes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "follow-"));
    const path = join(dir, "transcript.jsonl");
    await writeFile(path, "");
    let finished = false;
    const seen: string[] = [];
    const done = (async () => {
      for await (const event of followTranscript(
        path,
        async () => finished,
        10,
      ))
        seen.push(event.kind);
    })();
    await appendFile(
      path,
      '{"type":"stream_event","event":{"type":"message_start"}}\n{"type":"stream_',
    );
    await new Promise((r) => setTimeout(r, 50));
    await appendFile(path, 'event","event":{"type":"content_block_stop"}}\n');
    await new Promise((r) => setTimeout(r, 50));
    finished = true;
    await done;
    expect(seen).toEqual(["turn-start", "block-end"]);
  });
});

describe("followTranscript waits for a file that does not exist yet", () => {
  it("waits for a file that does not exist yet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "follow-"));
    const path = join(dir, "later.jsonl");
    let finished = false;
    const seen: string[] = [];
    const done = (async () => {
      for await (const event of followTranscript(
        path,
        async () => finished,
        10,
      ))
        seen.push(event.kind);
    })();
    await new Promise((r) => setTimeout(r, 30));
    await writeFile(
      path,
      '{"type":"stream_event","event":{"type":"message_start"}}\n',
    );
    await new Promise((r) => setTimeout(r, 50));
    finished = true;
    await done;
    expect(seen).toEqual(["turn-start"]);
  });
});

describe("followTranscript decodes multi-byte UTF-8 characters split across appends", () => {
  it("decodes a multi-byte UTF-8 character split across two appends", async () => {
    const dir = await mkdtemp(join(tmpdir(), "follow-"));
    const path = join(dir, "utf8.jsonl");
    await writeFile(path, "");
    let finished = false;
    const seen: unknown[] = [];
    const done = (async () => {
      for await (const event of followTranscript(
        path,
        async () => finished,
        10,
      ))
        seen.push(event);
    })();
    const line = Buffer.from(
      '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"café"}}}\n',
      "utf8",
    );
    // "é" is encoded as the two bytes 0xC3 0xA9; split the buffer between
    // them so one append ends, and the next begins, mid-character.
    const splitAt = line.indexOf(0xa9);
    await appendFile(path, line.subarray(0, splitAt));
    await new Promise((r) => setTimeout(r, 50));
    await appendFile(path, line.subarray(splitAt));
    await new Promise((r) => setTimeout(r, 50));
    finished = true;
    await done;
    expect(seen).toEqual([{ kind: "text-delta", text: "café" }]);
  });
});
