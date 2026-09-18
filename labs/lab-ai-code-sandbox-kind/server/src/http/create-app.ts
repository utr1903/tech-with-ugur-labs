import type { StructuredToolInterface } from "@langchain/core/tools";
import { Hono } from "hono";
import type { ChatAgent } from "../agent/build-agent.js";
import { registerChatRoutes } from "../chat/chat-routes.js";
import type { LlmMode } from "../config.js";
import type { Logger } from "../logger.js";

export function createApp({
  agent,
  tools,
  llmMode,
  logger,
}: {
  agent: ChatAgent;
  tools: StructuredToolInterface[];
  llmMode: LlmMode;
  logger: Logger;
}): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    logger.error({ err, path: c.req.path }, "Handling request failed.");
    return c.json(
      {
        error: "internal_error",
        message: "the server could not complete the request",
      },
      500,
    );
  });
  app.get("/api/tools", (c) =>
    c.json({
      llmMode,
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
    }),
  );
  registerChatRoutes(app, { agent, logger });
  return app;
}
