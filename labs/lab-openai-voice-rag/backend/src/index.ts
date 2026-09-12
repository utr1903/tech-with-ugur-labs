import { serve } from "@hono/node-server";
import OpenAI from "openai";
import { createChatStore } from "./chat/store.js";
import { readConfig } from "./config.js";
import { createCorpus } from "./corpus/index.js";
import {
	scriptedEmbed,
	scriptedEmbeddingIdentity,
} from "./corpus/scripted-embed.js";
import { createStore } from "./corpus/store.js";
import { createApp } from "./http/app.js";
import { safeError } from "./http/errors.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import {
	createEmbedding,
	openAIEmbeddingIdentity,
} from "./provider/embedding.js";
import { createOpenAIProvider } from "./provider/openai.js";
import { createScriptedProvider } from "./provider/scripted.js";

const logger = createLogger({ appName: "voice-rag" });
installGlobalErrorHandlers(logger);
try {
	const config = readConfig(process.env);
	const client =
		config.mode === "live"
			? new OpenAI({ apiKey: config.apiKey, maxRetries: 0, timeout: 30000 })
			: undefined;
	const corpus = createCorpus({
		...config,
		embed: client ? createEmbedding(client) : scriptedEmbed,
		embeddingIdentity: client
			? openAIEmbeddingIdentity
			: scriptedEmbeddingIdentity,
		logger,
	});
	await corpus.migrate();
	await corpus.ingest();
	const provider = client
		? createOpenAIProvider(client, logger)
		: createScriptedProvider();
	const chatDatabase = createStore(config.databaseUrl);
	const chats = createChatStore(chatDatabase, logger);
	const server = serve({
		fetch: createApp({ corpus, provider, chats, logger }).fetch,
		port: 3001,
		hostname: "0.0.0.0",
	});
	logger.info(
		{ mode: config.mode, port: 3001 },
		"Backend readiness succeeded.",
	);
	for (const signal of ["SIGINT", "SIGTERM"] as const)
		process.once(signal, () => {
			server.close(() => {
				void Promise.all([corpus.close(), chatDatabase.close()]).catch(
					(err) => {
						logger.error({ err: safeError(err) }, "Backend shutdown failed.");
						process.exitCode = 1;
					},
				);
			});
		});
} catch (err) {
	logger.error({ err: safeError(err) }, "Backend startup failed.");
	process.exit(1);
}
