import { buildAgent } from "./agent/build-agent.js";
import { createModel } from "./agent/model.js";
import { GardenChatSession } from "./agent/session.js";
import { createToolCallRecorder } from "./agent/tool-call-recorder.js";
import { createGardenTools } from "./agent/tools.js";
import { loadConfig } from "./config.js";
import { GardenSimulator } from "./garden/simulator.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { runScriptedConversation } from "./transport/script.js";
import { createTelegramBot } from "./transport/telegram.js";

const logger = createLogger({ appName: "garden-agent" });
installGlobalErrorHandlers(logger);

const config = loadConfig(process.env);
const garden = new GardenSimulator({ seed: config.gardenSeed });
const tools = createGardenTools({ garden, logger });
const model = createModel({ modelName: config.claudeModel });

logger.info(
  { transport: config.transport, model: config.claudeModel },
  "Garden agent starting...",
);

if (config.transport === "script") {
  const recorder = createToolCallRecorder();
  const agent = buildAgent({
    model,
    tools,
    logger,
    extraMiddleware: [recorder.middleware],
  });
  const session = new GardenChatSession({ agent, logger });
  const passed = await runScriptedConversation({
    session,
    recorder,
    garden,
    logger,
  });
  process.exitCode = passed ? 0 : 1;
} else {
  const telegram = config.telegram;
  if (telegram === undefined) {
    throw new Error("Telegram transport selected but not configured.");
  }
  const agent = buildAgent({ model, tools, logger });
  const session = new GardenChatSession({ agent, logger });
  const bot = createTelegramBot({
    botToken: telegram.botToken,
    allowedChatId: telegram.allowedChatId,
    session,
    logger,
  });
  logger.info({}, "Starting Telegram long polling...");
  await bot.start();
}
