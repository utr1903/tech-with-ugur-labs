import { z } from "zod";

/** The message returned to the model is capped to this length. */
const MAX_MESSAGE_LENGTH = 500;

/**
 * Checks a rejected tool call's arguments against the tool's own zod schema
 * and returns one "field: what was wrong" entry per issue, so the model can
 * correct the call. Returns `null` when the arguments fit, or when there is
 * no zod schema to check them against.
 */
export function describeInvalidArguments(
  schema: unknown,
  args: unknown,
): string | null {
  if (!(schema instanceof z.ZodType)) return null;
  const result = schema.safeParse(args);
  if (result.success) return null;
  return result.error.issues
    .map((issue) => {
      const field = issue.path.map(String).join(".") || "arguments";
      return `${field}: ${issue.message}`;
    })
    .join("; ")
    .slice(0, MAX_MESSAGE_LENGTH);
}
