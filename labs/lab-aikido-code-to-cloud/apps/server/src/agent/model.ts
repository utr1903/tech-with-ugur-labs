import { ChatBedrockConverse } from "@langchain/aws";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Config } from "../config";

export function createChatModel(config: Config): BaseChatModel {
  return new ChatBedrockConverse({ model: config.bedrockModelId, region: config.awsRegion });
}
