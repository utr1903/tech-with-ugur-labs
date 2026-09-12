import { expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { createScriptedProvider } from "../provider/scripted.js";
import { createApp } from "./app.js";

const logger = createLogger({ appName: "test" });
logger.level = "silent";
const corpus = {
	retrieve: async () => ({ sources: [], context: "" }),
	ingest: async () => ({ added: 1, changed: 0, deleted: 0, unchanged: 0 }),
};
it("returns voice credentials without a server-owned chat ID", async () => {
	const app = createApp({ corpus, provider: createScriptedProvider(), logger });
	expect(
		await (await app.request("/api/realtime/token", { method: "POST" })).json(),
	).toEqual({ mode: "scripted" });
});
it("rejects malformed UUIDs, empty queries, invalid JSON and oversized bodies", async () => {
	const app = createApp({ corpus, provider: createScriptedProvider(), logger });
	for (const body of [
		"{",
		"a".repeat(9000),
		JSON.stringify({ sessionId: "missing", query: "hello" }),
		JSON.stringify({
			sessionId: "11111111-1111-4111-8111-111111111111",
			query: " ",
		}),
	])
		expect(
			(await app.request("/api/agent", { method: "POST", body })).status,
		).toBe(400);
	expect((await app.request("/api/ready")).status).toBe(200);
});
it("withholds provider secrets", async () => {
	const provider = createScriptedProvider();
	provider.secret = async () => {
		throw Error("YOUR_OPENAI_API_KEY");
	};
	const response = await createApp({ corpus, provider, logger }).request(
		"/api/realtime/token",
		{ method: "POST" },
	);
	expect(response.status).toBe(502);
	expect(await response.text()).not.toContain("YOUR_OPENAI_API_KEY");
});
