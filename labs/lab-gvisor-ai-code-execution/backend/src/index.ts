import { Server } from "node:http";
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { createPool } from "./database/pool.js";
import { setupDatabase } from "./database/schema.js";
import { Executor } from "./execution/execute.js";
import {
	inClusterConfig,
	Kubernetes,
	ownedConfig,
} from "./execution/kubernetes.js";
import { setupChat } from "./graph/graph.js";
import { OpenAIModel } from "./graph/model.js";
import { ScriptedModel } from "./graph/scripted.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { recovery } from "./recovery.js";
import { createApp } from "./routes/app.js";
import { ThreadService } from "./threads/service.js";

const logger = createLogger({ appName: "contained-python" });
installGlobalErrorHandlers(logger);
const settings = config();
const pool = createPool(settings.databaseUrl);
await setupDatabase(pool);
const api = new Kubernetes(
	settings.inCluster
		? inClusterConfig()
		: ownedConfig(settings.kubeconfig, settings.context),
);
const executor = new Executor(pool, api, logger);
if (settings.mode === "openai" && !settings.apiKey)
	throw new Error("OpenAI key configuration required.");
const model =
	settings.mode === "openai"
		? new OpenAIModel({ apiKey: settings.apiKey ?? "", model: settings.model })
		: new ScriptedModel(settings.scenario, settings.source);
const service = new ThreadService(
	pool,
	await setupChat(pool, model, executor.execute.bind(executor)),
	logger,
);
const stopRecovery = recovery(executor, service, logger);
const server = serve({
	fetch: createApp(service, pool).fetch,
	hostname: settings.bind,
	port: 3001,
});
if (!(server instanceof Server)) throw new Error("HTTP server required.");
server.maxConnections = 32;
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
process.on("SIGTERM", () => {
	stopRecovery();
	server.close();
	setTimeout(() => process.exit(0), 35000).unref();
});
logger.info({ port: 3001 }, "Starting backend succeeded.");
