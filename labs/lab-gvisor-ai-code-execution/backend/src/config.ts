export function config() {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error("Database configuration required.");
	const mode = process.env.MODEL_MODE ?? "scripted";
	if (!["openai", "scripted"].includes(mode))
		throw new Error("Unknown model mode.");
	const bind = process.env.IN_CLUSTER === "true" ? "0.0.0.0" : "127.0.0.1";
	return {
		databaseUrl,
		mode,
		bind,
		apiKey: mode === "openai" ? process.env.OPENAI_API_KEY : undefined,
		model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
		scenario: process.env.SCRIPTED_SCENARIO ?? "conversation",
		source: process.env.SCRIPTED_SOURCE ?? "print(6*7)",
		kubeconfig: process.env.LAB_KUBECONFIG ?? "",
		context: process.env.LAB_KUBE_CONTEXT ?? "",
		inCluster: process.env.IN_CLUSTER === "true",
	};
}
