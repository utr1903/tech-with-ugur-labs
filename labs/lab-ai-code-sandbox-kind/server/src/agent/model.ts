import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Config } from "../config.js";
import { ScriptedChatModel } from "./scripted-model.js";

export function createChatModel(
  config: Pick<Config, "llmMode" | "anthropicApiKey" | "anthropicModel">,
): BaseChatModel {
  if (config.llmMode === "scripted") return new ScriptedChatModel({});
  return new ChatAnthropic({
    model: config.anthropicModel,
    apiKey: config.anthropicApiKey,
    maxTokens: 4096,
  });
}
