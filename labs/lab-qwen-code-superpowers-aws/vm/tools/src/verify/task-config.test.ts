import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listAcceptanceTests,
  listFixtures,
  readTaskConfig,
} from "./task-config.js";

let dir: string;

async function seedAcceptanceDir(options?: {
  verifyJson?: string;
  skipExpectedB?: boolean;
}): Promise<void> {
  const verifyJson =
    options?.verifyJson ??
    JSON.stringify({
      runCommand: ["npm", "run", "--silent", "summarize", "--"],
      programPattern: "summarize",
    });
  await writeFile(join(dir, "verify.json"), verifyJson);
  await mkdir(join(dir, "fixtures"), { recursive: true });
  await mkdir(join(dir, "expected"), { recursive: true });
  await writeFile(join(dir, "fixtures/a.log"), "a\n");
  await writeFile(join(dir, "fixtures/b.log"), "b\n");
  await writeFile(join(dir, "expected/a.json"), "{}");
  if (!options?.skipExpectedB) {
    await writeFile(join(dir, "expected/b.json"), "{}");
  }
  await writeFile(join(dir, "x.test.ts"), "");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "task-config-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readTaskConfig", () => {
  it("reads runCommand and programPattern from verify.json", async () => {
    await seedAcceptanceDir();
    await expect(readTaskConfig(dir)).resolves.toEqual({
      runCommand: ["npm", "run", "--silent", "summarize", "--"],
      programPattern: "summarize",
    });
  });

  it("throws naming a missing runCommand", async () => {
    await seedAcceptanceDir({
      verifyJson: JSON.stringify({ programPattern: "summarize" }),
    });
    await expect(readTaskConfig(dir)).rejects.toThrow("runCommand");
  });
});

describe("listFixtures", () => {
  it("returns fixtures sorted by name, with absolute input/expected paths", async () => {
    await seedAcceptanceDir();
    const fixtures = await listFixtures(dir);
    expect(fixtures.map((f) => f.name)).toEqual(["a", "b"]);
    expect(fixtures[0]).toEqual({
      name: "a",
      inputPath: join(dir, "fixtures/a.log"),
      expectedPath: join(dir, "expected/a.json"),
    });
  });

  it("throws naming a fixture with no matching expected file", async () => {
    await seedAcceptanceDir({ skipExpectedB: true });
    await expect(listFixtures(dir)).rejects.toThrow(
      "fixture b has no expected/b.json",
    );
  });
});

describe("listAcceptanceTests", () => {
  it("returns the *.test.ts files directly in the folder, as absolute paths", async () => {
    await seedAcceptanceDir();
    const tests = await listAcceptanceTests(dir);
    expect(tests).toEqual([join(dir, "x.test.ts")]);
  });
});
