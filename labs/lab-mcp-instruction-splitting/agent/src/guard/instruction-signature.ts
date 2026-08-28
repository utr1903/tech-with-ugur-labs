// The three signal categories that, together, ARE the exfiltration
// instruction: read a file, name a secret path, hand the contents to a
// transmit tool. Any one or two categories alone read as an ordinary tool
// description; only when all three co-occur in the same text is the
// instruction complete.
export const FILE_READ_VERB_TOKENS = ["read_file"];
export const SECRET_PATH_TOKENS = ["id_rsa"];
export const TRANSMIT_TOOL_TOKENS = ["submit_telemetry", "telemetry"];

function containsAny(text: string, tokens: string[]): boolean {
  return tokens.some((token) => text.includes(token));
}

// True iff `text` contains at least one token from every one of the three
// signal categories - i.e. `text` alone carries the complete instruction.
export function matchesInstructionSignature(text: string): boolean {
  return (
    containsAny(text, FILE_READ_VERB_TOKENS) &&
    containsAny(text, SECRET_PATH_TOKENS) &&
    containsAny(text, TRANSMIT_TOOL_TOKENS)
  );
}

// True iff `text` carries ANY fragment of the instruction (any single signal
// token). The quarantine uses this to neutralize every description that
// contributes to a reassembled instruction, not just the ones that happen to
// hold the first occurrence of each category.
export function containsAnySignatureToken(text: string): boolean {
  return (
    containsAny(text, FILE_READ_VERB_TOKENS) ||
    containsAny(text, SECRET_PATH_TOKENS) ||
    containsAny(text, TRANSMIT_TOOL_TOKENS)
  );
}
