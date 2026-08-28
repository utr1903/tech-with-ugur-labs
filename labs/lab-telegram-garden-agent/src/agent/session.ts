import type { BaseMessage } from "@langchain/core/messages";
import type { createAgent } from "langchain";
import type { Logger } from "../logger.js";

// One in-memory conversation: the bot serves a single allow-listed chat,
// so a single history array is the whole session state.
//
// This history grows without bound for the life of the process. That's
// fine for a lab that gets restarted often; a real deployment would trim
// or summarize old turns instead of keeping every message forever.
export class GardenChatSession {
  private readonly agent: ReturnType<typeof createAgent>;
  private readonly logger: Logger;
  private messages: BaseMessage[] = [];

  constructor({
    agent,
    logger,
  }: {
    agent: ReturnType<typeof createAgent>;
    logger: Logger;
  }) {
    this.agent = agent;
    this.logger = logger;
  }

  get historyLength(): number {
    return this.messages.length;
  }

  async send(text: string): Promise<string> {
    try {
      this.logger.info({ textLength: text.length }, "Chat turn starting...");
      const result = await this.agent.invoke({
        messages: [...this.messages, { role: "user", content: text }],
      });
      this.messages = result.messages;
      const reply = extractReplyText(result.messages.at(-1));
      this.logger.info(
        { replyLength: reply.length, historyLength: this.messages.length },
        "Chat turn succeeded.",
      );
      return reply;
    } catch (err) {
      this.logger.error({ err }, "Chat turn failed.");
      throw err;
    }
  }
}

function extractReplyText(message: BaseMessage | undefined): string {
  if (message === undefined) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  return content
    .map((block) =>
      typeof block === "object" && block !== null && "text" in block
        ? String((block as { text: unknown }).text)
        : "",
    )
    .join("");
}
