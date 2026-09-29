import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import OpenAI from "openai";
import pino from "pino";
import { expect, it, vi } from "vitest";
import { DraftReportError, draftReport } from "./agent.js";

it("uses the Responses endpoint for agent function tools", async () => {
	const root = await mkdtemp(join(tmpdir(), "report-routing-"));
	const paths: string[] = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
		paths.push(
			new URL(input instanceof Request ? input.url : String(input)).pathname,
		);
		return new Response(
			JSON.stringify({ error: { message: "stubbed provider response" } }),
			{ status: 400, headers: { "content-type": "application/json" } },
		);
	});
	try {
		await expect(
			draftReport({
				instruction: "Compare the requested sources.",
				requestedUrls: [],
				notes: [],
				workspaceDir: root,
				model: "gpt-6-sol",
				client: new OpenAI({ apiKey: "test" }),
				logger: pino({ level: "silent" }),
			}),
		).rejects.toBeInstanceOf(DraftReportError);
		expect(paths).toEqual(["/v1/responses"]);
	} finally {
		vi.restoreAllMocks();
		await rm(root, { recursive: true, force: true });
	}
});
