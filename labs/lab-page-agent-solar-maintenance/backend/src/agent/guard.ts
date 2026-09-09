import { z } from "zod";
import type { Config } from "../config.js";

// Not exported: nothing outside this file imports these by name yet (Task 8
// will, once it wires the guard into a route) — see the precedent in
// config.ts (LlmMode) and fleet/store.ts (Component).
interface ChatMessage {
  role: string;
  content?: string | null;
  [key: string]: unknown;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: unknown[];
  tool_choice?: unknown;
  parallel_tool_calls?: boolean;
  max_tokens: number;
}

export type GuardResult =
  | { ok: true; request: ChatRequest }
  | { ok: false; status: 400 | 413; error: string };

const incoming = z.object({
  messages: z.array(z.object({ role: z.string() }).loose()).min(1),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.unknown().optional(),
  parallel_tool_calls: z.boolean().optional(),
});

export function guardChatRequest(raw: unknown, config: Config): GuardResult {
  const parsed = incoming.safeParse(raw);
  if (!parsed.success)
    return { ok: false, status: 400, error: "Not a chat completion." };

  const { messages, tools, tool_choice, parallel_tool_calls } = parsed.data;

  if (messages.length > config.agentMaxMessages) {
    return { ok: false, status: 400, error: "Too many messages." };
  }
  const bytes = Buffer.byteLength(JSON.stringify(messages), "utf8");
  if (bytes > config.agentMaxRequestBytes) {
    return { ok: false, status: 413, error: "Request too large." };
  }

  // Only these four fields survive. `model` and `max_tokens` are ours, and
  // anything the client sent that is not named here — api_key, stream, user,
  // a different endpoint's parameters — is gone.
  return {
    ok: true,
    request: {
      model: config.geminiModel,
      max_tokens: config.agentMaxTokens,
      messages: messages as ChatMessage[],
      ...(tools === undefined ? {} : { tools }),
      ...(tool_choice === undefined ? {} : { tool_choice }),
      ...(parallel_tool_calls === undefined ? {} : { parallel_tool_calls }),
    },
  };
}
