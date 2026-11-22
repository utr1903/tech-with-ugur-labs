import { S3Client } from "@aws-sdk/client-s3";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createS3Store } from "./data/s3";
import { createChatModel } from "./agent/model";
import { SessionStore } from "./agent/memory";
import { createChatService } from "./agent/chat";
import { log } from "./logger";

const config = loadConfig();
const store = createS3Store(new S3Client({ region: config.awsRegion }), config.dataBucket);
const chat = createChatService({ model: createChatModel(config), store, sessions: new SessionStore() });
const app = createApp({ config, chat });
const server = app.listen(config.port, () => {
  log("PayBuddy listening", { url: `http://localhost:${config.port}` });
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
