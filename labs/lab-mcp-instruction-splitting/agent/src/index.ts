import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { buildChatModel } from "./model.js";

export { createApp } from "./app.js";

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // .env is optional - compose deployments set env vars directly.
  }

  const logger = createLogger({ appName: "agent" });
  installGlobalErrorHandlers(logger);

  const config = loadConfig(process.env);
  const model = buildChatModel(config);
  const app = createApp({ config, logger, model });

  app.listen(config.port, () => {
    logger.info({ port: config.port, guard: config.guard }, "Agent listening.");
  });
}

// Only start the server when this file is run directly, so importing
// createApp for tests never opens a port.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(() => {
    process.exit(1);
  });
}
