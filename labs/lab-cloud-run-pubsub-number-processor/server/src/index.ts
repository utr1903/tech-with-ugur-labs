import { serve } from "@hono/node-server";
import { createServerApp } from "./http/app.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { createGooglePublishNumber } from "./pubsub/publisher.js";

const logger = createLogger({ appName: "number-publisher" });
installGlobalErrorHandlers(logger);

const projectId = process.env.GOOGLE_CLOUD_PROJECT;
const topicName = process.env.PUBSUB_TOPIC;
if (!projectId || !topicName) {
  throw new Error("GOOGLE_CLOUD_PROJECT and PUBSUB_TOPIC are required");
}

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const publish = createGooglePublishNumber({ projectId, topicName, logger });
const app = createServerApp({ publish, logger });

serve({ fetch: app.fetch, port });
logger.info({ port }, "Starting HTTP server succeeded.");
