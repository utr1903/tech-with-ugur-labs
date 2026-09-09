import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import { createGeminiTransport } from "./gemini.js";
import type { ChatMessage, ChatRequest } from "./guard.js";
import { agentOutput } from "./scripted/envelope.js";
import { resolveNextAction } from "./scripted/resolver.js";

export type Transport = (
  request: ChatRequest,
  messages: ChatMessage[],
) => Promise<unknown>;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createTransport(config: Config, logger: Logger): Transport {
  if (config.llmMode === "gemini") {
    const forward = createGeminiTransport(config, logger);
    return async (request) => await forward(request);
  }
  return async (request, messages) => {
    const step = resolveNextAction(messages, today());
    logger.info(
      { nextGoal: step.nextGoal },
      "Resolving a scripted step succeeded.",
    );
    return agentOutput(request.model, step.nextGoal, step.action);
  };
}
