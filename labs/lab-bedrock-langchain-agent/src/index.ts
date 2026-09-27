import { serve } from "@hono/node-server";
import { createAnswerQuestion } from "./agent/answer.js";
import { createTools } from "./agent/tools/index.js";
import { parseConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { seedDatabase } from "./db/seed.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { createApp } from "./server/app.js";

// Startup order matters: the server must not listen before the schema and
// the data exist, so that a ready answer means "you can ask questions now".
// AWS is not contacted here; a missing login shows up on the first question.
const config = parseConfig(process.env);
const logger = createLogger({ appName: "shop-agent", level: config.logLevel });
installGlobalErrorHandlers(logger);

const { db, pool } = createDatabase(config.databaseUrl);
await runMigrations(db, logger);
await seedDatabase(db, logger);

const tools = createTools({ db, logger });
const answerQuestion = createAnswerQuestion({
  region: config.awsRegion,
  tools,
});
const app = createApp({ answerQuestion, logger });

const server = serve({ fetch: app.fetch, port: config.port }, () => {
  logger.info(
    {
      port: config.port,
      region: config.awsRegion,
      tools: tools.map((tool) => tool.name),
    },
    "Listening.",
  );
});

// Docker stops containers with SIGTERM; close cleanly so `make down` is fast.
process.on("SIGTERM", () => {
  logger.info("Shutting down...");
  server.close(() => {
    pool.end().then(() => process.exit(0));
  });
});
