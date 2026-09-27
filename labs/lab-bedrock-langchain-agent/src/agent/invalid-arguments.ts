import type { ToolInputParsingException } from "@langchain/core/tools";

/** The generic message used whenever the real one cannot be trusted. */
export const INVALID_ARGUMENTS_GENERIC =
  "The arguments did not fit the tool's schema.";

/** Every field-level message is capped to this length before it is returned to the model. */
const MAX_MESSAGE_LENGTH = 500;

/**
 * Matches a filesystem path, so a message built from a validation error
 * never reaches the model if it happens to carry one.
 */
const PATH_LIKE_PATTERN = /\/(home|app|node_modules)\/|\.aws/;

/** One zod issue reduced to the field it complains about and why. */
type ValidationIssue = { path: string; issueMessage: string };

/**
 * Pulls the per-field zod issues back out of a `ToolInputParsingException`.
 * Every tool schema is created with `verboseParsingErrors: true`, so the
 * exception's message carries the issues as a JSON array right after
 * "Details: ", one blank line before zod's own human-readable summary.
 * Returns `null` when that block is missing or is not valid JSON, which
 * should not happen but must not crash the run if it ever does.
 */
function readValidationIssues(
  err: ToolInputParsingException,
): ValidationIssue[] | null {
  const [detailsParagraph] = err.message.split("\n\n");
  const jsonStart = detailsParagraph?.indexOf("[") ?? -1;
  if (!detailsParagraph || jsonStart === -1) return null;
  try {
    const issues = JSON.parse(detailsParagraph.slice(jsonStart)) as Array<{
      path?: unknown[];
      message?: string;
    }>;
    if (issues.length === 0) return null;
    return issues.map((issue) => ({
      path:
        Array.isArray(issue.path) && issue.path.length > 0
          ? issue.path.join(".")
          : "(root)",
      issueMessage:
        typeof issue.message === "string" ? issue.message : "invalid value",
    }));
  } catch {
    return null;
  }
}

/**
 * Builds the message returned to the model for a rejected tool call: one
 * "field: what was expected" entry per issue. Falls back to the generic
 * message when the issues cannot be read, or when the text would ever
 * contain a filesystem path, since that must never reach the model.
 */
export function describeInvalidArguments(
  err: ToolInputParsingException,
): string {
  const issues = readValidationIssues(err);
  if (!issues) return INVALID_ARGUMENTS_GENERIC;
  const combined = issues
    .map((issue) => `${issue.path}: ${issue.issueMessage}`)
    .join("; ");
  if (PATH_LIKE_PATTERN.test(combined)) return INVALID_ARGUMENTS_GENERIC;
  return combined.slice(0, MAX_MESSAGE_LENGTH);
}
