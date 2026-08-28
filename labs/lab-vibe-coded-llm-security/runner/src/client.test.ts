import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countOccurrences, readEvidence } from "./client.js";

describe("readEvidence", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "runner-client-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty string when the file does not exist", () => {
    expect(readEvidence(join(dir, "missing.log"))).toBe("");
  });

  it("returns the file contents when it exists", () => {
    const file = join(dir, "evidence.log");
    writeFileSync(file, "line one\nline two\n");
    expect(readEvidence(file)).toBe("line one\nline two\n");
  });
});

describe("countOccurrences", () => {
  it("counts non-overlapping occurrences of a substring", () => {
    expect(countOccurrences("a-b-a-b-a", "a")).toBe(3);
  });

  it("returns 0 when the substring is absent", () => {
    expect(countOccurrences("nothing here", "missing")).toBe(0);
  });
});
