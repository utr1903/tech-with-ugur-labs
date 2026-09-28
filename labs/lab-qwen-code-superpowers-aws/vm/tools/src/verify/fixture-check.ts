/**
 * Compares one fixture's command output against its expected JSON,
 * naming exactly which top-level fields disagree so a verifier
 * failure is diagnosable at a glance rather than a bare "mismatch".
 */
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import type { StepResult } from "./process.js";
import type { Fixture } from "./task-config.js";

/** Top-level keys where expected and actual values are not deep-equal, sorted. */
function diffingKeys(
  expected: Record<string, unknown>,
  actual: unknown,
): string[] {
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
    return Object.keys(expected).sort();
  }
  const actualRecord = actual as Record<string, unknown>;
  const keys = new Set([
    ...Object.keys(expected),
    ...Object.keys(actualRecord),
  ]);
  return [...keys]
    .filter((k) => !isDeepStrictEqual(expected[k], actualRecord[k]))
    .sort();
}

/** Compares one fixture's step result against its expected JSON; returns a problem string, or null when it matches. */
export async function checkFixture(
  fixture: Fixture,
  result: StepResult,
): Promise<string | null> {
  if (result.timedOut) return "timed out";
  if (result.code !== 0) return `exit ${result.code}`;
  let actual: unknown;
  try {
    actual = JSON.parse(result.stdout);
  } catch {
    return "output is not JSON";
  }
  const expected = JSON.parse(
    await readFile(fixture.expectedPath, "utf8"),
  ) as Record<string, unknown>;
  const diffs = diffingKeys(expected, actual);
  return diffs.length === 0 ? null : `${diffs.join(", ")} differs`;
}
