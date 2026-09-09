import { z } from "zod";
import type { Config } from "../config.js";

export interface ChatMessage {
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

  // Size EVERYTHING the client controls that we would forward, not just the
  // messages. `tools` and `tool_choice` are opaque to us, so a caller could
  // otherwise slip a tiny message array past the cap alongside a gigantic tool
  // schema and have us relay it upstream on our key. The count cap runs first
  // so an obviously bad request is rejected before we serialise anything.
  const forwarded = JSON.stringify({ messages, tools, tool_choice });
  if (Buffer.byteLength(forwarded, "utf8") > config.agentMaxRequestBytes) {
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
