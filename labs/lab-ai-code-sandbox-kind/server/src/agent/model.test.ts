import { ChatAnthropic } from "@langchain/anthropic";
import { describe, expect, it } from "vitest";
import { createChatModel } from "./model.js";
import { ScriptedChatModel } from "./scripted-model.js";

describe("createChatModel", () => {
  it("uses the scripted model without a key", () => {
    expect(
      createChatModel({
        llmMode: "scripted",
        anthropicApiKey: undefined,
        anthropicModel: "claude-sonnet-5",
      }),
    ).toBeInstanceOf(ScriptedChatModel);
  });

  it("uses Anthropic with the configured model in live mode", () => {
    const model = createChatModel({
      llmMode: "live",
      anthropicApiKey: "test-key",
      anthropicModel: "claude-sonnet-5",
    });
    expect(model).toBeInstanceOf(ChatAnthropic);
    expect((model as ChatAnthropic).model).toBe("claude-sonnet-5");
  });
});
