import {
  MultipleStructuredOutputsError,
  StructuredOutputParsingError,
} from "langchain";
import { reportDraftSchema } from "./report.js";

// Structured-tool parsing happens inside LangChain, before the draft reaches our validator.
// Convert only those typed errors to application feedback; all other failures still propagate.
export async function invokeCandidate(
  work: () => Promise<{ structuredResponse?: unknown }>,
): Promise<{ candidate: unknown; schemaErrors?: string[] }> {
  try {
    const state = await work();
    return { candidate: state.structuredResponse };
  } catch (err) {
    const schemaErrors = structuredErrors(err);
    if (!schemaErrors) throw err;
    return { candidate: undefined, schemaErrors };
  }
}

function structuredErrors(err: unknown): string[] | undefined {
  let current = err;
  for (let depth = 0; depth < 12 && current instanceof Error; depth += 1) {
    if (current instanceof MultipleStructuredOutputsError)
      return [
        "report_draft: multiple_structured_outputs; return exactly one draft",
      ];
    if (current instanceof StructuredOutputParsingError) {
      // Error strings can contain rejected values. Emit only application-owned field names/codes.
      const fields = Object.keys(reportDraftSchema.shape).filter(
        (field) =>
          current instanceof StructuredOutputParsingError &&
          current.errors.some(
            (message) =>
              message.includes(`"${field}"`) || message.includes(`/${field}`),
          ),
      );
      return fields.length
        ? fields.map((field) => `${field}: invalid_or_missing`)
        : ["report_draft: schema_mismatch"];
    }
    current = current.cause;
  }
  return undefined;
}
