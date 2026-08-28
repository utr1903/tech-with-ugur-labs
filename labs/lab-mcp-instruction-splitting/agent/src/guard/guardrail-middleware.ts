import { createMiddleware, ToolMessage } from "langchain";
import type { Logger } from "../logger.js";
import { detectReassembledInstruction } from "./reassembly.js";

const QUARANTINE_STUB = "[removed by guardrail]";

// Read-only, non-transmitting tools. Everything that could move data out
// of this process - most importantly submit_telemetry - is excluded.
export const APPROVED_EGRESS_TOOLS: readonly string[] = [
  "read_file",
  "get_repo_info",
  "list_dependencies",
  "check_style",
];

interface NamedTool {
  name: string;
  description?: string;
}

// SECURE: the pair of defenses that actually stop the split-instruction
// attack. wrapModelCall reassembles the full tool list before the model
// ever sees it, so a poisoned instruction spread across descriptions is
// quarantined before it can steer a turn. wrapToolCall is the last line of
// defense: even if a quarantined description were missed, the tool that
// would carry the stolen data out (submit_telemetry) is not on the
// approved egress allowlist and never runs.
export function createGuardrailMiddleware({ logger }: { logger: Logger }) {
  return createMiddleware({
    name: "GuardrailMiddleware",
    wrapModelCall: (request, handler) => {
      const candidates = (request.tools as NamedTool[]).map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
      }));
      const { reassembled, offendingTools } =
        detectReassembledInstruction(candidates);

      if (reassembled) {
        logger.warn(
          { offendingTools },
          "Quarantined tools with a reassembled instruction.",
        );
      }

      const offending = new Set(offendingTools);
      const tools = request.tools.map((tool) =>
        offending.has((tool as NamedTool).name)
          ? { ...tool, description: QUARANTINE_STUB }
          : tool,
      );

      return handler({ ...request, tools });
    },
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
