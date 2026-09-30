// Conservative, application-owned permission. Searching inside supplied content is not discovery.
export function externalSearchAllowed(instruction: string): boolean {
  const wording = instruction.replace(/https?:\/\/[^\s<>]+/gi, "");
  const restrictions = [
    /\b(?:do not|don't|never|without|no)\s+(?:\w+\s+){0,2}(?:search|discovery|discover)\b/i,
    /\b(?:only|solely|exclusively|limited to|restricted to)\b[^.;\n]{0,50}\b(?:supplied|provided|given|these|input)\s+(?:pages?|urls?|sources?|documents?|content)\b/i,
    /\b(?:search|discover|find)\s+(?:(?:only|exclusively|solely|just|within|in|on|through|the)\s+){0,5}(?:supplied|provided|given|these|input)\s+(?:pages?|urls?|sources?|documents?|content)\b/i,
  ];
  if (restrictions.some((pattern) => pattern.test(wording))) return false;
  return (
    /\b(?:search|discover|find)\s+(?:for\s+)?(?:the\s+)?(?:web|internet|online|external|additional|other|new)\b/i.test(
      wording,
    ) ||
    /\b(?:current|latest|recent|additional)\s+(?:\w+\s+){0,2}(?:context|sources?|articles?|pages?|information|updates?|research)\b/i.test(
      wording,
    )
  );
}
