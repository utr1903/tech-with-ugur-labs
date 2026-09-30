const suppliedWords = new Set([
  "supplied",
  "provided",
  "given",
  "these",
  "input",
]);
const contentWords = new Set([
  "page",
  "pages",
  "url",
  "urls",
  "source",
  "sources",
  "document",
  "documents",
  "content",
  "site",
  "sites",
  "article",
  "articles",
  "link",
  "links",
  "material",
  "materials",
]);
const restrictiveWords = new Set([
  "only",
  "solely",
  "exclusively",
  "just",
  "limited",
  "restricted",
  "confined",
]);
const discoveryWords = new Set(["search", "discover", "find"]);
const targetFillers = new Set(["for", "the"]);
const externalTargets = new Set(["web", "internet", "online", "external"]);

// Scope restrictions win before discovery intent. Word classification avoids depending
// on noun modifiers or whether "only" occurs before or after the supplied-content phrase.
export function externalSearchAllowed(instruction: string): boolean {
  const wording = instruction.replace(/https?:\/\/[^\s<>]+/gi, "");
  const words = wording.toLowerCase().match(/[a-z]+/g) ?? [];
  const suppliedContent =
    words.some((word) => suppliedWords.has(word)) &&
    words.some((word) => contentWords.has(word));
  if (suppliedContent && words.some((word) => restrictiveWords.has(word)))
    return false;
  if (externalDiscoveryProhibited(wording)) return false;
  if (explicitExternalTarget(words) || additionalSourceRequest(wording))
    return true;
  // Context inside supplied content alone does not request external discovery.
  if (suppliedContent) return false;
  return (
    /\b(?:search|discover|find)\s+(?:for\s+)?(?:the\s+)?(?:additional|other|new)\b/i.test(
      wording,
    ) ||
    /\b(?:current|latest|recent|additional)\s+(?:\w+\s+){0,2}(?:context|sources?|articles?|pages?|information|updates?|research)\b/i.test(
      wording,
    )
  );
}

function externalDiscoveryProhibited(wording: string): boolean {
  const denial = "\\b(?:do not|don't|never|without|no)\\s+";
  const generalSearchDenial = new RegExp(
    `${denial}(?:(?:perform|conduct|carry\\s+out|undertake|do|make|attempt|any)\\s+){0,2}(?:(?:external|web|internet|online)\\s+)?(?:search|discovery|discover)\\b`,
    "i",
  );
  const useSearchDenial = new RegExp(
    `${denial}use\\s+(?:(?:any|external|web|internet|online)\\s+){0,2}(?:search\\b(?!\\s+(?:results?|snippets?|as\\s+evidence)\\b)|discovery\\b|discover\\b)`,
    "i",
  );
  if (generalSearchDenial.test(wording) || useSearchDenial.test(wording))
    return true;
  const deniedTargets = [
    // Negation must govern a discovery scope, not an unrelated output request.
    "find\\s+(?:for\\s+)?(?:the\\s+)?(?:web|internet|online|external|additional|other|new|independent)\\b",
    "find\\s+(?:for\\s+)?(?:the\\s+)?sources?\\s+from\\s+(?:the\\s+)?(?:web|internet|online|external)\\b",
    "(?:add|include)\\s+(?:(?:additional|other|new|independent|external|web)\\s+)+sources?\\b",
    "(?:add|include)\\s+(?:(?:current|latest|recent|additional)\\s+)?context\\s+from\\s+(?:(?:additional|other|new)(?:\\s+independent)?|independent|external|web)\\s+sources?\\b",
    "(?:add|include)\\s+sources?\\s+from\\s+(?:the\\s+)?(?:web|internet|online|external)\\b",
  ];
  return deniedTargets.some((target) =>
    new RegExp(`${denial}${target}`, "i").test(wording),
  );
}

function additionalSourceRequest(wording: string): boolean {
  // An inside/within qualifier keeps the matched request in supplied content.
  return (
    /\b(?:search|discover|find)\s+(?:for\s+)?(?:the\s+)?(?:additional|other|new)\s+(?:independent\s+)?sources?\b(?!\s+(?:inside|within)\s+(?:the\s+)?(?:supplied|provided|given|these|those|input)\b)/i.test(
      wording,
    ) ||
    /\b(?:add|include)\s+(?:(?:current|latest|recent|additional)\s+)?context\s+from\s+(?:additional|other|new)\s+(?:independent\s+)?sources?\b(?!\s+(?:inside|within)\s+(?:the\s+)?(?:supplied|provided|given|these|those|input)\b)/i.test(
      wording,
    )
  );
}

function explicitExternalTarget(words: string[]): boolean {
  return words.some((word, index) => {
    if (!discoveryWords.has(word)) return false;
    let target = index + 1;
    while (targetFillers.has(words[target] ?? "")) target += 1;
    const scope = words[target] ?? "";
    if (!externalTargets.has(scope)) return false;
    // "Web page" names a document; "the web" names the external discovery scope.
    return scope !== "web" || !contentWords.has(words[target + 1] ?? "");
  });
}
