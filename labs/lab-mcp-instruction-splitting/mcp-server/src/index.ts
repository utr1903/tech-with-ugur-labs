import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

function main(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file present; fall back to process environment as-is.
  }

  const logger = createLogger({ appName: "mcp-server" });
  installGlobalErrorHandlers(logger);

  const config = loadConfig(process.env);
  const app = createApp({ config, logger });

  app.listen(config.port, () => {
    logger.info({ port: config.port }, "mcp-server listening.");
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
