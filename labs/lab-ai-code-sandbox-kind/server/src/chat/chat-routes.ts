import { toUIMessageStream } from "@ai-sdk/langchain";
import { HumanMessage } from "@langchain/core/messages";
import { createUIMessageStreamResponse } from "ai";
import type { Hono } from "hono";
import { z } from "zod";
import type { ChatAgent } from "../agent/build-agent.js";
import type { Logger } from "../logger.js";
import { parseChatRequest } from "./chat-request.js";
import { toUIMessages } from "./history-mapper.js";

// Must match the mode proven by stream-history-parity.test.ts.
const STREAM_MODE = ["values", "messages"] as const;

export function registerChatRoutes(
  app: Hono,
  { agent, logger }: { agent: ChatAgent; logger: Logger },
): void {
  app.post("/api/chat", async (c) => {
    const parsed = parseChatRequest(await c.req.json().catch(() => null));
    if (!parsed.ok)
      return c.json({ error: "invalid_request", message: parsed.message }, 400);
    const { threadId, text } = parsed.value;
    const log = logger.child({ threadId });
    log.info({ chars: text.length }, "Streaming chat turn...");
    try {
      const stream = await agent.stream(
        { messages: [new HumanMessage(text)] },
        {
          configurable: { thread_id: threadId },
          streamMode: [...STREAM_MODE],
          signal: c.req.raw.signal,
        },
      );
      return createUIMessageStreamResponse({
        stream: toUIMessageStream(stream, {
          onFinish: () => log.info("Streaming chat turn succeeded."),
          onError: (err) => log.error({ err }, "Streaming chat turn failed."),
          onAbort: () => log.warn("Streaming chat turn aborted by the client."),
        }),
      });
    } catch (err) {
      log.error({ err }, "Streaming chat turn failed.");
      throw err;
    }
  });

  app.get("/api/threads/:threadId/messages", async (c) => {
    const threadId = c.req.param("threadId");
    if (!z.uuid().safeParse(threadId).success)
      return c.json(
        { error: "invalid_request", message: "threadId must be a UUID" },
        400,
      );
    const log = logger.child({ threadId });
    log.info("Loading thread history...");
    try {
      const state = await agent.graph.getState({
        configurable: { thread_id: threadId },
      });
      const messages = toUIMessages(state.values?.messages ?? []);
      log.info({ count: messages.length }, "Loading thread history succeeded.");
      return c.json({ threadId, messages });
    } catch (err) {
      log.error({ err }, "Loading thread history failed.");
      throw err;
    }
  });
}
