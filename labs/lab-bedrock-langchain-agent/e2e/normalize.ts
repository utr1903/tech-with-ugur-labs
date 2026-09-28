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
 * True when the answer contains the expected value. A number must stand
 * alone as a token: it must not be directly attached to a letter, digit or
 * underscore on either side, must not be preceded by a digit plus "." or
 * ",", and must not be followed by "." plus a digit. Expecting 7 does not
 * accept ID7, 7th, order7, 7x, item_7 or v7.1, but does accept 7 surrounded
 * by whitespace, punctuation, brackets, or the start or end of the text.
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
    `(?<![a-z0-9_])(?<!\\d[.,])${escapeRegExp(needle)}(?![a-z0-9_])(?!\\.\\d)`,
  );
  return standsAlone.test(haystack);
}
