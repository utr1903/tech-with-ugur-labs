import { Bot } from "grammy";
import type { GardenChatSession } from "../agent/session.js";
import type { Logger } from "../logger.js";

const REFUSAL_REPLY = "Sorry, this is a private garden bot.";
const ERROR_REPLY =
  "Something went wrong tending the garden. Please try again.";

export interface IncomingMessage {
  chatId: number;
  text: string;
}

export interface MessageHandlerDeps {
  allowedChatId: number;
  session: GardenChatSession;
  logger: Logger;
}

// The allow-list is the bot's entire authorization model: Telegram
// authenticates the transport, this check authenticates the person.
export async function handleIncomingMessage(
  deps: MessageHandlerDeps,
  message: IncomingMessage,
): Promise<string> {
  const { allowedChatId, session, logger } = deps;
  if (message.chatId !== allowedChatId) {
    logger.warn(
      { chatId: message.chatId },
      "Refused message from non-allow-listed chat.",
    );
    return REFUSAL_REPLY;
  }
  try {
    return await session.send(message.text);
  } catch (err) {
    logger.error({ err }, "Handling incoming message failed.");
    return ERROR_REPLY;
  }
}

export function createTelegramBot(deps: {
  botToken: string;
  allowedChatId: number;
  session: GardenChatSession;
  logger: Logger;
}): Bot {
  const { botToken, allowedChatId, session, logger } = deps;
  const bot = new Bot(botToken);
  bot.on("message:text", async (ctx) => {
    const reply = await handleIncomingMessage(
      { allowedChatId, session, logger },
      { chatId: ctx.chat.id, text: ctx.message.text },
    );
    await ctx.reply(reply);
  });
  bot.catch((err) => {
    logger.error({ err }, "Telegram bot loop error.");
  });
  return bot;
}
