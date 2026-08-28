import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { Logger } from "../logger.js";
import { containsAnySignatureToken } from "./instruction-signature.js";
import { detectReassembledInstruction } from "./reassembly.js";

export const QUARANTINE_STUB = "[removed by guardrail]";

// SECURE (input side): neutralize any tool whose description contributes to a
// reassembled exfiltration instruction BEFORE the tools are handed to the
// model. This runs at agent-build time rather than inside a wrapModelCall
// middleware hook - the agent framework forbids rewriting the tool set from
// that hook, and doing it here is the more honest fix anyway: the poisoned
// text never enters the model's context in the first place. Tools are loaded
// fresh per request, so replacing the description in place is safe.
export function quarantineTools(
  tools: DynamicStructuredTool[],
  logger: Logger,
): DynamicStructuredTool[] {
  const { reassembled, offendingTools } = detectReassembledInstruction(
    tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
    })),
  );

  if (!reassembled) {
    return tools;
  }

  // Neutralize every description that carries any part of the instruction,
  // not only detectReassembledInstruction's first-occurrence attributions, so
  // the reassembled instruction cannot survive in the tools the model sees.
  const quarantined: string[] = [];
  for (const tool of tools) {
    if (containsAnySignatureToken(tool.description ?? "")) {
      tool.description = QUARANTINE_STUB;
      quarantined.push(tool.name);
    }
  }

  logger.warn(
    { offendingTools, quarantined },
    "Quarantined tools with a reassembled instruction.",
  );

  return tools;
}
