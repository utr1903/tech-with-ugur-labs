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

/**
 * Compares against the exact staged object URI (not a substring match on the
 * Drive file id), so a citation cannot pass by accidentally containing another
 * document's id as a fragment.
 */
export function checkCitesDocument(name: string, result: AnswerResult, expectedUri: string): Check {
  const passed = result.citedUris.includes(expectedUri);
  return {
    name,
    passed,
    detail: passed
      ? `cited ${expectedUri}`
      : `expected a citation to ${expectedUri}, got [${result.citedUris.join(", ")}]`,
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

export function checkCount(name: string, actual: number, expected: number): Check {
  return {
    name,
    passed: actual === expected,
    detail: `${actual} (expected ${expected})`,
  };
}

export function checkIdsPresent(name: string, actual: string[], expected: string[]): Check {
  const missing = expected.filter((id) => !actual.includes(id));
  return {
    name,
    passed: missing.length === 0,
    detail:
      missing.length === 0 ? `all ${expected.length} present` : `missing [${missing.join(", ")}]`,
  };
}

export function checkIdsAbsent(name: string, actual: string[], forbidden: string[]): Check {
  const present = forbidden.filter((id) => actual.includes(id));
  return {
    name,
    passed: present.length === 0,
    detail:
      present.length === 0
        ? `none of the ${forbidden.length} are indexed`
        : `still indexed [${present.join(", ")}]`,
  };
}

export function checkExactly(name: string, actual: string[], expected: string[]): Check {
  const passed =
    actual.length === expected.length && expected.every((value) => actual.includes(value));
  return {
    name,
    passed,
    detail: passed
      ? `exactly [${expected.join(", ")}]`
      : `expected [${expected.join(", ")}], got [${actual.join(", ")}]`,
  };
}

export function summarize(checks: Check[]): { total: number; failed: number; ok: boolean } {
  const failed = checks.filter((check) => !check.passed).length;
  return { total: checks.length, failed, ok: failed === 0 };
}
