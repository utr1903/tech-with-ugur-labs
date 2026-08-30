import { FakeToolCallingModel } from "langchain";
import { describe, expect, it } from "vitest";
import { buildAgent } from "../agent/build-agent.js";
import { GardenChatSession } from "../agent/session.js";
import { createGardenTools } from "../agent/tools.js";
import { GardenSimulator } from "../garden/simulator.js";
import { createLogger } from "../logger.js";
import { handleIncomingMessage } from "./telegram.js";

function silentLogger() {
  const logger = createLogger({ appName: "telegram-test" });
  logger.level = "silent";
  return logger;
}

function buildSession(logger: ReturnType<typeof silentLogger>) {
  const garden = new GardenSimulator({ seed: 42 });
  const agent = buildAgent({
    model: new FakeToolCallingModel({ toolCalls: [[], []] }),
    tools: createGardenTools({ garden, logger }),
    logger,
  });
  return new GardenChatSession({ agent, logger });
}

describe("handleIncomingMessage", () => {
  it("refuses a chat that is not the allow-listed one", async () => {
    const logger = silentLogger();
    const deps = {
      allowedChatId: 1234,
      session: buildSession(logger),
      logger,
    };
    const reply = await handleIncomingMessage(deps, {
      chatId: 9999,
      text: "hi",
    });
    expect(reply).toBe("Sorry, this is a private garden bot.");
  });

  it("answers the allow-listed chat via the agent session", async () => {
    const logger = silentLogger();
    const deps = {
      allowedChatId: 1234,
      session: buildSession(logger),
      logger,
    };
    const reply = await handleIncomingMessage(deps, {
      chatId: 1234,
      text: "hello garden",
    });
    expect(typeof reply).toBe("string");
    expect(reply).not.toBe("Sorry, this is a private garden bot.");
  });

  it("turns a failed agent turn into a friendly error reply", async () => {
    const logger = silentLogger();
    const brokenSession = {
      send: async () => {
        throw new Error("boom");
      },
    } as unknown as ReturnType<typeof buildSession>;
    const reply = await handleIncomingMessage(
      { allowedChatId: 1234, session: brokenSession, logger },
      { chatId: 1234, text: "hi" },
    );
    expect(reply).toBe(
      "Something went wrong tending the garden. Please try again.",
    );
  });
});
