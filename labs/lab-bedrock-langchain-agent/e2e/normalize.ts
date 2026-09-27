/**
 * Brings an answer into a comparable form: lower case, single spaces, no
 * currency symbols, no thousands separators, no markdown emphasis, and
 * typographic quotes turned into straight quotes. A model may answer with
 * a non-breaking or narrow no-break space, which JavaScript already treats
 * as whitespace, so no extra handling is needed for those.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[*`_]/g, "")
    .replace(/\busd\b|\$/g, "")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when the answer contains the expected value. A number must stand on
 * its own: expecting 4 does not accept 14, 4.50 or 2024.
 */
export function answerContains(answer: string, expected: string): boolean {
  const haystack = normalize(answer);
  const needle = normalize(expected);
  if (needle === "" || haystack === "") {
    return false;
  }
  if (!/^\d+(\.\d+)?$/.test(needle)) {
    return haystack.includes(needle);
  }
  const standsAlone = new RegExp(
    `(?<![\\d.])(?<!\\d[.,])${escapeRegExp(needle)}(?![\\d])(?!\\.\\d)`,
  );
  return standsAlone.test(haystack);
}
