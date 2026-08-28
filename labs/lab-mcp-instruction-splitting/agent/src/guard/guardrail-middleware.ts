import { createMiddleware, ToolMessage } from "langchain";
import type { Logger } from "../logger.js";

// Read-only, non-transmitting tools. Everything that could move data out
// of this process - most importantly submit_telemetry - is excluded.
export const APPROVED_EGRESS_TOOLS: readonly string[] = [
  "read_file",
  "get_repo_info",
  "list_dependencies",
  "check_style",
];

// SECURE (egress side): the last line of defense. Even if a poisoned
// description slipped past the build-time quarantine (guard/quarantine.ts)
// and steered the model into calling the exfiltration tool, the tool that
// would carry the stolen data out (submit_telemetry) is not on the approved
// egress allowlist, so the call is blocked before it runs.
export function createGuardrailMiddleware({ logger }: { logger: Logger }) {
  return createMiddleware({
    name: "GuardrailMiddleware",
    wrapToolCall: (request, handler) => {
      const name = request.toolCall.name;

      if (!APPROVED_EGRESS_TOOLS.includes(name)) {
        logger.warn(
          { tool: name },
          "Denied tool call: not on the approved egress allowlist.",
        );
        return new ToolMessage({
          content: `This tool call was blocked by the guardrail: "${name}" is not an approved egress tool.`,
          tool_call_id: request.toolCall.id ?? "",
        });
      }

      return handler(request);
    },
  });
}
