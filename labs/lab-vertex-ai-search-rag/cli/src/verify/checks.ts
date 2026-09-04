import type { AnswerResult } from "../search/answer.js";

export interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat || "(empty answer)";
}

export function checkContainsFact(name: string, result: AnswerResult, fact: string): Check {
  const passed = result.text.includes(fact);
  return {
    name,
    passed,
    detail: passed ? `found "${fact}"` : `expected "${fact}" in: ${excerpt(result.text)}`,
  };
}

export function checkOmitsFact(name: string, result: AnswerResult, fact: string): Check {
  const passed = !result.text.includes(fact);
  const skipped = `skipped: [${result.skippedReasons.join(", ")}]`;
  const gotBack = `got back: ${excerpt(result.text)}`;
  return {
    name,
    passed,
    detail: passed
      ? `no sign of "${fact}" without retrieval (${skipped}, ${gotBack})`
      : `"${fact}" appeared without retrieval: ${excerpt(result.text)}`,
  };
}

export function checkCitesOnly(name: string, result: AnswerResult, expectedUri: string): Check {
  const passed = result.citedUris.length === 1 && result.citedUris[0] === expectedUri;
  return {
    name,
    passed,
    detail: passed
      ? `cited ${expectedUri}`
      : `expected only ${expectedUri}, got [${result.citedUris.join(", ")}]`,
  };
}

export function checkCitesAll(name: string, result: AnswerResult, expectedUris: string[]): Check {
  const missing = expectedUris.filter((uri) => !result.citedUris.includes(uri));
  return {
    name,
    passed: missing.length === 0,
    detail:
      missing.length === 0
        ? `cited all ${expectedUris.length} documents`
        : `missing [${missing.join(", ")}]`,
  };
}

export function checkGrounded(name: string, result: AnswerResult, threshold: number): Check {
  const score = result.groundingScore;
  const passed = score !== null && score >= threshold;
  return {
    name,
    passed,
    detail: `grounding score ${score ?? "n/a"} (threshold ${threshold})`,
  };
}

export function checkAbstains(name: string, result: AnswerResult, threshold: number): Check {
  const skipped = result.skippedReasons.length > 0;
  const uncitedAndUngrounded =
    result.citedUris.length === 0 && (result.groundingScore ?? 0) < threshold;
  const passed = skipped || uncitedAndUngrounded;
  return {
    name,
    passed,
    detail: passed
      ? `abstained (skipped: [${result.skippedReasons.join(", ")}], citations: ${result.citedUris.length}, grounding: ${result.groundingScore ?? "n/a"})`
      : `answered anyway: ${excerpt(result.text)}`,
  };
}

export function checkDocumentCount(name: string, actual: number, expected: number): Check {
  return {
    name,
    passed: actual === expected,
    detail: `${actual} of ${expected} documents indexed`,
  };
}

export function summarize(checks: Check[]): { total: number; failed: number; ok: boolean } {
  const failed = checks.filter((check) => !check.passed).length;
  return { total: checks.length, failed, ok: failed === 0 };
}
