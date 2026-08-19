import { timingSafeEqual } from "node:crypto";

export function isAuthorized(
  header: string | undefined,
  apiToken: string,
): boolean {
  if (header === undefined || !header.startsWith("Bearer ")) {
    return false;
  }
  const presented = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(apiToken);
  if (presented.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(presented, expected);
}
