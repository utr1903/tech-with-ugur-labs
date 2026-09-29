import { resolve } from "node:path";
import { runReport } from "./commands/report.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "url-report" });
installGlobalErrorHandlers(logger);

await runReport(process.argv.slice(2).join(" "), {
	workspaceDir: resolve("workspace"),
	apiKey: process.env.OPENAI_API_KEY,
	model: process.env.OPENAI_MODEL,
	searchModel: process.env.OPENAI_SEARCH_MODEL,
	logger,
}).catch(() => {
	process.exitCode = 1;
});
