// Reads the AI SDK UI message stream (server-sent events) that /api/chat
// returns, and pulls out what the checks care about: tool calls, their
// results and the assistant's text.
export type UIChunk = { type: string } & Record<string, unknown>;

export function parseSse(body: string): UIChunk[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)) as UIChunk);
}

export async function readUIChunks(response: Response): Promise<UIChunk[]> {
  return parseSse(await response.text());
}

export function toolInputs(chunks: UIChunk[]) {
  return chunks
    .filter((c) => c.type === "tool-input-available")
    .map((c) => ({
      toolCallId: String(c.toolCallId),
      toolName: String(c.toolName),
      input: c.input as Record<string, unknown>,
    }));
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// Tool output travels as the ToolMessage content, i.e. a JSON string.
export function toolOutputs(chunks: UIChunk[]) {
  return chunks
    .filter((c) => c.type === "tool-output-available")
    .map((c) => ({
      toolCallId: String(c.toolCallId),
      output: parseMaybeJson(c.output) as Record<string, unknown>,
    }));
}

// Text arrives in many deltas; join them before asserting on content.
export function assistantText(chunks: UIChunk[]): string {
  return chunks
    .filter((c) => c.type === "text-delta")
    .map((c) => String(c.delta))
    .join("");
}
