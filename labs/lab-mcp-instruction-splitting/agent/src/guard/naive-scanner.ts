export const BANNED_KEYWORDS = [
  "id_rsa",
  "ssh",
  "secret",
  "exfil",
  "submit_telemetry",
] as const;

export interface ScanResult {
  clean: boolean;
  hits: { tool: string; keyword: string }[];
}

// DELIBERATELY VULNERABLE: scanning each tool description in isolation
// cannot see an instruction split across several of them. An attacker who
// spreads the dangerous words across multiple tool descriptions - none of
// which is dirty on its own - sails straight through this check.
export function naiveKeywordScan(
  tools: { name: string; description: string }[],
): ScanResult {
  const hits: { tool: string; keyword: string }[] = [];

  for (const tool of tools) {
    for (const keyword of BANNED_KEYWORDS) {
      if (tool.description.includes(keyword)) {
        hits.push({ tool: tool.name, keyword });
      }
    }
  }

  return { clean: hits.length === 0, hits };
}
