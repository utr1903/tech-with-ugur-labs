import { serve } from "@hono/node-server";
import { buildAgent } from "./agent/build-agent.js";
import { createChatModel } from "./agent/model.js";
import { createCheckpointer } from "./chat/checkpointer.js";
import { loadConfig } from "./config.js";
import { createApp } from "./http/create-app.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { fetchCapabilities } from "./sandbox/capabilities.js";
import { createCodeExecutorTool } from "./sandbox/code-executor-tool.js";
import {
  assertClientTimeoutExceedsExecution,
  createExecuteClient,
} from "./sandbox/execute-client.js";

const logger = createLogger({ appName: "code-sandbox-server" });
installGlobalErrorHandlers(logger);

const config = loadConfig(process.env);
const capabilities = await fetchCapabilities({
  sandboxUrl: config.sandboxUrl,
  logger,
});
assertClientTimeoutExceedsExecution(
  config.sandboxClientTimeoutMs,
  capabilities.limits.executionTimeoutSeconds,
);
const checkpointer = await createCheckpointer({
  databaseUrl: config.databaseUrl,
  logger,
});
const client = createExecuteClient({
  sandboxUrl: config.sandboxUrl,
  timeoutMs: config.sandboxClientTimeoutMs,
  logger,
});
const tools = [createCodeExecutorTool({ capabilities, client })];
const agent = buildAgent({
  model: createChatModel(config),
  tools,
  checkpointer,
  logger,
  today: new Date(),
});
const app = createApp({ agent, tools, llmMode: config.llmMode, logger });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info(
    { port: info.port, llmMode: config.llmMode },
    "Server listening.",
  );
});

process.on("SIGTERM", () => {
  logger.info("Shutting down...");
  server.close(() => {
    checkpointer.end().then(
      () => process.exit(0),
      (err: unknown) => {
        logger.error({ err }, "Shutting down failed.");
        process.exit(1);
      },
    );
  });
});
