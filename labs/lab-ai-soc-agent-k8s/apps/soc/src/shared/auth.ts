import { timingSafeEqual } from "node:crypto";

const PREFIX = "Bearer ";

/**
 * Constant-time bearer token check. Buffers of different length can
 * never be equal, so that case returns false without comparing. An
 * empty expected token never matches, so a missing secret cannot turn
 * into an open door.
 */
export function bearerMatches(
  header: string | undefined,
  expected: string,
): boolean {
  if (!header?.startsWith(PREFIX) || expected.length === 0) return false;
  const given = Buffer.from(header.slice(PREFIX.length));
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length) return false;
  return timingSafeEqual(given, wanted);
}
