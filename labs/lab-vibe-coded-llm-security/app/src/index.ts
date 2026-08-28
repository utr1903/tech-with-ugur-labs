import express from "express";
import { loadConfig } from "./config.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { createRouter } from "./routes/router.js";

try {
  process.loadEnvFile();
} catch {
  // No .env file present; rely on the environment as provided.
}

const logger = createLogger({ appName: "vibe-coded-app" });
installGlobalErrorHandlers(logger);

const config = loadConfig(process.env);

const app = express();
app.use(express.json());
app.use(createRouter({ config, logger }));

app.listen(config.port, () => {
  logger.info(
    { port: config.port, variant: config.variant },
    "vibe-coded-app listening.",
  );
});
