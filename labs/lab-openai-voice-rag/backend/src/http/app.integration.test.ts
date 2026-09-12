import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createCorpus } from "../corpus/index.js";
import { scriptedEmbed } from "../corpus/scripted-embed.js";
import { createLogger } from "../logger.js";
import { createScriptedProvider } from "../provider/scripted.js";
import { createApp } from "./app.js";

it("serves grounded HTTP answers from real persisted PostgreSQL evidence", async () => {
	const databaseUrl = process.env.TEST_DATABASE_URL;
	if (
		!databaseUrl ||
		!new URL(databaseUrl).pathname.endsWith("/voice_rag_test")
	)
		throw Error("Dedicated test database required");
	const documentsRoot = await mkdtemp(join(tmpdir(), "http-corpus-"));
	const logger = createLogger({ appName: "http-test" });
	logger.level = "silent";
	const corpus = createCorpus({
		databaseUrl,
		documentsRoot,
		embed: scriptedEmbed,
		logger,
	});
	try {
		await writeFile(
			join(documentsRoot, "amber.md"),
			"The amber valve recovery code is ORCHID-47.",
		);
		await corpus.migrate();
		await corpus.ingest();
		const app = createApp({
			corpus,
			provider: createScriptedProvider(),
			logger,
		});
		const token = await app.request("/api/realtime/token", { method: "POST" });
		expect(token.status).toBe(200);
		const { conversationId } = await token.json();
		const response = await app.request("/api/agent", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				conversationId,
				question: "What is the amber valve recovery code?",
			}),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			answer: expect.stringContaining("ORCHID-47"),
			sources: [expect.objectContaining({ filename: "amber.md" })],
		});
		await writeFile(
			join(documentsRoot, "amber.md"),
			"The amber valve recovery code is LILY-22.",
		);
		expect(
			await (await app.request("/api/ingest", { method: "POST" })).json(),
		).toMatchObject({ changed: 1 });
		const updated = await app.request("/api/agent", {
			method: "POST",
			body: JSON.stringify({
				conversationId,
				question: "amber valve recovery code",
			}),
		});
		expect((await updated.json()).answer).toContain("LILY-22");
	} finally {
		await corpus.close();
		await rm(documentsRoot, { recursive: true, force: true });
	}
});
