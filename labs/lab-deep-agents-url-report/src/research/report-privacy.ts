import type { LedgerSnapshot } from "./ledger.js";

export function redactCoverage<T>(record: T, ledger: LedgerSnapshot): T {
  const text = (value: string): string => {
    let safe = value;
    for (const source of ledger.sources) {
      if (source.text)
        safe = safe.replaceAll(source.text, "[page content omitted]");
    }
    return safe
      .replace(/\b(?:sk|fc)-[\w-]+\b/g, "[redacted]")
      .replace(/https?:\/\/[^\s<>]+/g, redactUrl);
  };
  // Projected coverage contains JSON data only; redact every string, including draft reasons.
  return JSON.parse(
    JSON.stringify(record, (_key, value: unknown) =>
      typeof value === "string" ? text(value) : value,
    ),
  ) as T;
}

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    for (const key of url.searchParams.keys()) {
      if (/(?:key|token|secret|password|authorization)/i.test(key))
        url.searchParams.set(key, "redacted");
    }
    return url.href;
  } catch {
    return "[invalid URL omitted]";
  }
}
