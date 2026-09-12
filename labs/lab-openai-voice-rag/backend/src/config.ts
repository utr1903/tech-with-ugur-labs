import { SafeError } from "./http/errors.js";
export function readConfig(env: NodeJS.ProcessEnv) {
	const mode = env.MODE ?? "scripted";
	if (mode !== "scripted" && mode !== "live")
		throw new SafeError("MODE must be scripted or live");
	if (!env.DATABASE_URL) throw new SafeError("DATABASE_URL is required");
	if (mode === "live" && !env.OPENAI_API_KEY)
		throw new SafeError("OPENAI_API_KEY is required in live mode");
	return {
		mode,
		databaseUrl: env.DATABASE_URL,
		documentsRoot: env.DOCUMENTS_ROOT ?? "/documents",
		apiKey: env.OPENAI_API_KEY,
	};
}
