import { expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { createScriptedProvider } from "../provider/scripted.js";
import { createApp } from "./app.js";

const corpus = {
	retrieve: async () => ({ sources: [], context: "" }),
	ingest: async () => ({ added: 1, changed: 0, deleted: 0, unchanged: 0 }),
};
it("creates fresh conversations and validates HTTP bodies", async () => {
	const app = createApp({
		corpus,
		provider: createScriptedProvider(),
		logger: createLogger({ appName: "test" }),
	});
	const first = await (
		await app.request("/api/realtime/token", { method: "POST" })
	).json();
	const second = await (
		await app.request("/api/realtime/token", { method: "POST" })
	).json();
	expect(first.conversationId).toBeTruthy();
	expect(first.conversationId).not.toBe(second.conversationId);
	expect(
		(await app.request("/api/agent", { method: "POST", body: "{" })).status,
	).toBe(400);
	expect(
		(
			await app.request("/api/agent", {
				method: "POST",
				body: JSON.stringify({ conversationId: "missing", question: "hello" }),
			})
		).status,
	).toBe(404);
	expect(
		(
			await app.request("/api/agent", {
				method: "POST",
				body: "a".repeat(9000),
			})
		).status,
	).toBe(400);
	expect((await app.request("/api/ready")).status).toBe(200);
	expect(
		await (await app.request("/api/ingest", { method: "POST" })).json(),
	).toMatchObject({ added: 1 });
});
it("withholds raw provider errors and keys", async () => {
	const provider = createScriptedProvider();
	provider.secret = async () => {
		throw Error("sk-permanent-private");
	};
	const app = createApp({
		corpus,
		provider,
		logger: createLogger({ appName: "test" }),
	});
	const response = await app.request("/api/realtime/token", { method: "POST" });
	expect(response.status).toBe(502);
	expect(await response.text()).not.toContain("sk-permanent");
});
