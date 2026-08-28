import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEvidence, readEvidence } from "./evidence.js";

describe("evidence", () => {
  let evidenceFile: string;

  beforeEach(() => {
    evidenceFile = join(
      tmpdir(),
      `attacker-evidence-${randomUUID()}`,
      "evidence.log",
    );
  });

  afterEach(() => {
    if (existsSync(evidenceFile)) {
      rmSync(evidenceFile);
    }
  });

  it("returns an empty string when the file does not exist", () => {
    expect(readEvidence(evidenceFile)).toBe("");
  });

  it("round-trips an appended line, creating the parent dir", () => {
    appendEvidence(evidenceFile, "first line");
    appendEvidence(evidenceFile, "second line");

    expect(readEvidence(evidenceFile)).toBe("first line\nsecond line\n");
  });
});
