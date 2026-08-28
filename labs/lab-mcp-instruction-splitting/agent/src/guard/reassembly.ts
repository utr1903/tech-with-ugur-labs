import {
  FILE_READ_VERB_TOKENS,
  matchesInstructionSignature,
  SECRET_PATH_TOKENS,
  TRANSMIT_TOOL_TOKENS,
} from "./instruction-signature.js";

export interface ReassemblyResult {
  reassembled: boolean;
  offendingTools: string[];
}

// Finds the first occurrence, in `text`, of any token in `tokens`, returning
// its character span. Used to map a matched signature token in the joined
// string back to the original tool description(s) it came from.
function findFirstTokenSpan(
  text: string,
  tokens: string[],
): { start: number; end: number } | undefined {
  let best: { start: number; end: number } | undefined;
  for (const token of tokens) {
    const index = text.indexOf(token);
    if (index === -1) {
      continue;
    }
    const span = { start: index, end: index + token.length };
    if (!best || span.start < best.start) {
      best = span;
    }
  }
  return best;
}

// SECURE: unlike the naive scanner, this reads the tool list the way an
// MCP client actually presents it to a model - as one combined view - so an
// instruction split across several tool descriptions cannot hide from it.
export function detectReassembledInstruction(
  tools: { name: string; description: string }[],
): ReassemblyResult {
  const selfContained = tools.filter((tool) =>
    matchesInstructionSignature(tool.description),
  );
  if (selfContained.length > 0) {
    return {
      reassembled: true,
      offendingTools: selfContained.map((tool) => tool.name),
    };
  }

  let joined = "";
  const spans: { name: string; start: number; end: number }[] = [];
  for (const tool of tools) {
    const start = joined.length;
    joined += tool.description;
    spans.push({ name: tool.name, start, end: joined.length });
  }

  if (!matchesInstructionSignature(joined)) {
    return { reassembled: false, offendingTools: [] };
  }

  const contributing = new Set<string>();
  for (const tokens of [
    FILE_READ_VERB_TOKENS,
    SECRET_PATH_TOKENS,
    TRANSMIT_TOOL_TOKENS,
  ]) {
    const match = findFirstTokenSpan(joined, tokens);
    if (!match) {
      continue;
    }
    for (const span of spans) {
      const overlaps = match.start < span.end && match.end > span.start;
      if (overlaps) {
        contributing.add(span.name);
      }
    }
  }

  return { reassembled: true, offendingTools: [...contributing] };
}
