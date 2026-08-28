// Default-deny egress allow-list: a URL is only allowed when it parses
// cleanly and its hostname is explicitly present in `allowedHosts`.
export function isAllowedUrl(
  url: string,
  allowedHosts: readonly string[],
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  return allowedHosts.includes(parsed.hostname);
}
