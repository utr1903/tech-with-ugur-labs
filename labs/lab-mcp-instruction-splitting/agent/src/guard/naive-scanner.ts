import { matchesInstructionSignature } from "./instruction-signature.js";

export interface ScanResult {
  clean: boolean;
  hits: { tool: string }[];
}

// DELIBERATELY VULNERABLE: this inspects each tool description in complete
// isolation. An instruction split across several tool descriptions - none
// of which is individually complete - never trips this check, because no
// single description ever carries the full read-verb + secret-path +
// transmit-tool signature on its own. Only reading every description
// together (as detectReassembledInstruction does) can catch it.
export function naivePerToolScan(
  tools: { name: string; description: string }[],
): ScanResult {
  const hits: { tool: string }[] = [];

  for (const tool of tools) {
    if (matchesInstructionSignature(tool.description)) {
      hits.push({ tool: tool.name });
    }
  }

  return { clean: hits.length === 0, hits };
}
