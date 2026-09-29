/**
 * Reads a task's acceptance folder: the verifier's config (which
 * command to run and how to recognize the program), the fixture and
 * expected-output pairs, and the hidden test files. Kept separate from
 * the checks that use it so the fixture-pairing and validation rules
 * are testable without spawning any process.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

export interface TaskConfig {
  runCommand: string[];
  programPattern: string;
}

export interface Fixture {
  name: string;
  inputPath: string;
  expectedPath: string;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === "string")
  );
}

/** Reads and validates verify.json from an acceptance folder. */
export async function readTaskConfig(
  acceptanceDir: string,
): Promise<TaskConfig> {
  const text = await readFile(join(acceptanceDir, "verify.json"), "utf8");
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (!isNonEmptyStringArray(raw.runCommand)) {
    throw new Error("verify.json: missing or invalid field runCommand");
  }
  if (typeof raw.programPattern !== "string") {
    throw new Error("verify.json: missing or invalid field programPattern");
  }
  return { runCommand: raw.runCommand, programPattern: raw.programPattern };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Lists fixtures/<name>.* paired with their required expected/<name>.json, sorted by name. */
export async function listFixtures(acceptanceDir: string): Promise<Fixture[]> {
  const fixturesDir = join(acceptanceDir, "fixtures");
  const expectedDir = join(acceptanceDir, "expected");
  const files = (await readdir(fixturesDir)).sort();
  const fixtures: Fixture[] = [];
  for (const file of files) {
    const name = basename(file, extname(file));
    const expectedPath = join(expectedDir, `${name}.json`);
    if (!(await fileExists(expectedPath))) {
      throw new Error(`fixture ${name} has no expected/${name}.json`);
    }
    fixtures.push({ name, inputPath: join(fixturesDir, file), expectedPath });
  }
  return fixtures;
}

/** Lists the *.test.ts files directly in the acceptance folder, sorted, as absolute paths. */
export async function listAcceptanceTests(
  acceptanceDir: string,
): Promise<string[]> {
  const files = await readdir(acceptanceDir);
  return files
    .filter((f) => f.endsWith(".test.ts"))
    .sort()
    .map((f) => join(acceptanceDir, f));
}
