import type { ReportDraft, ValidationFeedback } from "./report-schema.js";

export { renderCoverage, type CoverageRecord } from "./report-coverage.js";
export {
  reportDraftSchema,
  type ReportDraft,
  type ValidationFeedback,
} from "./report-schema.js";
export { validateDraft } from "./report-validation.js";

// Render the validated snapshot so later draft mutations cannot add unchecked claims.
export function renderReport(
  _draft: ReportDraft,
  feedback: ValidationFeedback,
): string {
  const citation = (id: string) =>
    `[${plain(id)}](${destination(feedback.sourceUrls[id] ?? "")})`;
  const lines = [
    "# Research report",
    "",
    `Status: ${feedback.status === "complete" ? "Complete" : "Partial"}`,
    "",
    "## Articles",
    "",
  ];
  for (const article of feedback.articles)
    lines.push(`- ${plain(article.summary)} ${citation(article.sourceId)}`);
  if (!feedback.articles.length) lines.push("No validated article summaries.");
  if (feedback.themes.length) {
    lines.push("", "## Themes", "");
    for (const theme of feedback.themes)
      lines.push(
        `- ${plain(theme.claim)} ${theme.sourceIds.map(citation).join(" ")}`,
      );
  }
  lines.push("", "## Selection", "");
  for (const selection of feedback.selectedUrls)
    lines.push(
      `- [Selected article](${destination(selection.url)}): ${plain(selection.reason)}`,
    );
  lines.push(
    "",
    "## Coverage and limitations",
    "",
    plain(feedback.coverageNarrative),
  );
  for (const reason of feedback.reasons) lines.push(`- ${plain(reason)}`);
  for (const omission of feedback.knownOmissions)
    lines.push(
      `- Omitted${omission.url ? ` ${plain(omission.url)}` : ""}: ${plain(omission.reason)}`,
    );
  return `${lines.join("\n")}\n`;
}

function plain(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/[\[\]()*_`<>#!|]/g, "\\$&")
    .replace(/[\r\n]+/g, " ");
}
function destination(url: string): string {
  return url.replace(/[()<>\s]/g, (character) => encodeURIComponent(character));
}
