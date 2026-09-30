export function requestsExhaustiveListing(instruction: string): boolean {
  const quantified =
    /\b(all|every|each)\s+((?:[\w-]+\s+){0,3}?)(articles?|posts?|pages?|urls?|entries|links?)\b/gi;
  for (const match of instruction.matchAll(quantified)) {
    const modifiers = match[2] ?? "";
    if (
      /\b(?:selected|chosen|supplied|provided|requested|input)\b/i.test(
        modifiers,
      )
    )
      continue;
    if (match[1]?.toLowerCase() !== "each") return true;
    // "Each" commonly refers to supplied pages or citation formatting. Require site scope.
    const after = instruction.slice((match.index ?? 0) + match[0].length);
    if (
      /^\s+(?:on|from|in|across)\s+(?:(?:the|this|that|supplied|provided)\s+)?(?:listing|site|website|blog|archive|collection)\b/i.test(
        after,
      )
    )
      return true;
  }
  return false;
}
