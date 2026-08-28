import { ChatOllama } from "@langchain/ollama";
import type { AgentConfig } from "./config.js";

export function buildChatModel(config: AgentConfig): ChatOllama {
  return new ChatOllama({
    model: config.ollamaModel,
    baseUrl: config.ollamaBaseUrl,
    // A small model calls tools reliably only with deterministic sampling
    // and thinking mode off; both are load-bearing, not preferences.
    temperature: 0,
    think: false,
    numCtx: config.ollamaNumCtx,
    keepAlive: "10m",
  });
}
