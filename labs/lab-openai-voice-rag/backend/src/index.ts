import { createCorpus } from "./corpus/index.js";
import { scriptedEmbed } from "./corpus/scripted-embed.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "voice-rag" });
installGlobalErrorHandlers(logger);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const corpus = createCorpus({
	databaseUrl,
	documentsRoot: process.env.DOCUMENTS_ROOT ?? "/documents",
	embed: scriptedEmbed,
	logger,
});
await corpus.migrate();
await corpus.ingest();
logger.info({ mode: "scripted" }, "Corpus readiness succeeded.");
const keepAlive = setInterval(() => {}, 60000);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, async () => {
		clearInterval(keepAlive);
		await corpus.close();
	});
}
