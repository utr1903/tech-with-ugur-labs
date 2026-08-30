import { ChatAnthropic } from "@langchain/anthropic";

// ANTHROPIC_API_KEY is read from the environment by the client itself.
export function createModel({
  modelName,
}: {
  modelName: string;
}): ChatAnthropic {
  return new ChatAnthropic({
    model: modelName,
    temperature: 0,
    maxTokens: 1024,
  });
}
