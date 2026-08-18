import { ChatOllama } from "@langchain/ollama";
import type { AppConfig } from "../config.js";

export function buildChatModel(config: AppConfig): ChatOllama {
  return new ChatOllama({
    model: config.ollamaModel,
    baseUrl: config.ollamaBaseUrl,
    // A 4B model calls tools reliably only with deterministic sampling
    // and thinking mode off; both are load-bearing, not preferences.
    temperature: 0,
    think: false,
    numCtx: config.ollamaNumCtx,
    keepAlive: "10m",
  });
}
