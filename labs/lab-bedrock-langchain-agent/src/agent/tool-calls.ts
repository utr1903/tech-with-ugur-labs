import {
  AIMessage,
  type BaseMessage,
  ToolMessage,
} from "@langchain/core/messages";

/** What the API reports about one tool call the agent made. */
export type ToolCallSummary = {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  total: number | null;
};

/** Whether one tool call succeeded, and how many rows matched. */
type Outcome = { ok: boolean; total: number | null };

/**
 * Reads `ok` and `total` from a tool result; anything unreadable is a
 * failure. Used for the API response and for the tool-call log line.
 */
export function readOutcome(content: unknown): Outcome {
  try {
    const parsed = JSON.parse(String(content)) as {
      ok?: unknown;
      total?: unknown;
    };
    if (parsed.ok === true && typeof parsed.total === "number") {
      return { ok: true, total: parsed.total };
    }
  } catch {
    // Not JSON: reported as a failed call below.
  }
  return { ok: false, total: null };
}

/**
 * Lists the tool calls of one agent run from its message history. Reading
 * them from the messages keeps the server free of per-request shared state.
 */
export function summarizeToolCalls(messages: BaseMessage[]): ToolCallSummary[] {
  const outcomes = new Map<string, Outcome>();
  for (const message of messages) {
    if (ToolMessage.isInstance(message)) {
      outcomes.set(message.tool_call_id, readOutcome(message.content));
    }
  }
  return messages
    .filter((message) => AIMessage.isInstance(message))
    .flatMap((message) => message.tool_calls ?? [])
    .map((call) => ({
      name: call.name,
      args: call.args as Record<string, unknown>,
      ...(outcomes.get(call.id ?? "") ?? { ok: false, total: null }),
    }));
}
