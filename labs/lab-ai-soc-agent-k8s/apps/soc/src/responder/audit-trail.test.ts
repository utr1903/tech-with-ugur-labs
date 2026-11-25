import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAuditTrail } from "./audit-trail.js";

async function tmpFile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "soc-audit-")), "audit.jsonl");
}

describe("audit trail", () => {
  it("returns an empty list when the file does not exist", async () => {
    expect(await createAuditTrail(await tmpFile()).read()).toEqual([]);
  });

  it("round-trips entries in order and stamps a time", async () => {
    const trail = createAuditTrail(await tmpFile());
    await trail.append({ event: "a", n: 1 });
    await trail.append({ event: "b", n: 2 });
    const entries = await trail.read();
    expect(entries.map((e) => e.event)).toEqual(["a", "b"]);
    expect(typeof entries[0]?.time).toBe("string");
  });

  it("writes one JSON object per line and only ever appends", async () => {
    const file = await tmpFile();
    const trail = createAuditTrail(file);
    await trail.append({ event: "a" });
    const first = await readFile(file, "utf8");
    await trail.append({ event: "b" });
    const second = await readFile(file, "utf8");
    expect(second.startsWith(first)).toBe(true);
    expect(second.trimEnd().split("\n")).toHaveLength(2);
  });

  it("keeps lines intact under concurrent appends", async () => {
    const trail = createAuditTrail(await tmpFile());
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => trail.append({ event: "x", i })),
    );
    expect(await trail.read()).toHaveLength(25);
  });
});
