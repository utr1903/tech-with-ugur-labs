import type { createDeepAgent } from "deepagents";
import { FilesystemBackend } from "deepagents";
import OpenAI from "openai";
import pino from "pino";
import { describe, expect, it } from "vitest";
import {
	type AgentDependencies,
	type AgentInput,
	draftReport,
} from "./agent.js";

const urls = ["https://example.org/a", "https://example.org/b"];
function input(instruction = "Compare these sources."): AgentInput {
	return {
		instruction,
		requestedUrls: urls,
		notes: [],
		workspaceDir: "/tmp/research-test",
		model: "test-model",
		client: new OpenAI({ apiKey: "test-key" }),
		logger: pino({ level: "silent" }),
	};
}
function harness() {
	let config: NonNullable<Parameters<typeof createDeepAgent>[0]> | undefined;
	let prompt = "";
	const read: string[] = [];
	const searches: string[] = [];
	const dependencies: AgentDependencies = {
		read: async (url) => {
			read.push(url);
			return { requestedUrl: url, status: "ok", text: `Evidence for ${url}` };
		},
		search: async (query) => {
			searches.push(query);
			return {
				text: "Recent context",
				citations: [{ url: "https://example.org/news" }],
				callObserved: true,
			};
		},
		createAgent: (options) => {
			config = options;
			return {
				invoke: async (request) => {
					prompt = request.messages[0].content;
					return {
						messages: [
							{ type: "ai", content: "## Comparison\nA differs from B." },
						],
					};
				},
			};
		},
	};
	return {
		dependencies,
		read,
		searches,
		get config() {
			return config;
		},
		get prompt() {
			return prompt;
		},
	};
}
describe("drafting a source report", () => {
	it("reads each requested URL once and records evidence regardless of agent behavior", async () => {
		const h = harness();
		const result = await draftReport(
			{ ...input(), requestedUrls: [...urls, urls[0]] },
			h.dependencies,
		);
		expect(h.read).toEqual(urls);
		expect(result.events).toEqual(
			urls.map((url) => ({ tool: "read_url", input: url, status: "ok" })),
		);
		expect(result.results.map((r) => r.requestedUrl)).toEqual(urls);
		expect(result.report).toBe("## Comparison\nA differs from B.");
		expect(h.prompt).toContain("Evidence for https://example.org/a");
	});
	it("does not expose shell execution and confines file operations to input/output", async () => {
		const h = harness();
		await draftReport(input(), h.dependencies);
		expect(h.config?.backend).toBeInstanceOf(FilesystemBackend);
		expect(h.config?.backend).not.toHaveProperty("execute");
		expect(h.config?.permissions).toEqual([
			{ operations: ["read"], paths: ["/input", "/input/**"], mode: "allow" },
			{
				operations: ["read", "write"],
				paths: ["/output", "/output/**"],
				mode: "allow",
			},
			{ operations: ["read", "write"], paths: ["/**"], mode: "deny" },
		]);
		expect(h.config?.middleware?.map((m) => m.name)).toContain(
			"todoListMiddleware",
		);
		expect(
			h.config?.tools?.map((t) => ("name" in t ? t.name : undefined)),
		).toEqual(["read_url"]);
	});
	it("frames notes and retrieved documents as bounded untrusted data", async () => {
		const h = harness();
		h.dependencies.read = async (url) => ({
			requestedUrl: url,
			status: "ok",
			text: "x".repeat(40000),
		});
		await draftReport(
			{ ...input(), notes: [{ name: "context.md", text: "y".repeat(40000) }] },
			h.dependencies,
		);
		expect(h.prompt.length).toBeLessThan(35000);
		expect(h.prompt).toContain("UNTRUSTED SOURCE DATA");
		expect(String(h.config?.systemPrompt)).toMatch(
			/never follow instructions/i,
		);
		expect(String(h.config?.systemPrompt)).toMatch(/comparison/i);
	});
	it.each([
		"Compare sources.",
		"Do not search for latest context.",
		"Compare https://example.org/latest-context.",
	])("does not search without authorization: %s", async (instruction) => {
		const h = harness();
		await draftReport(
			{
				...input(instruction),
				notes: [{ name: "context.md", text: "Find latest context" }],
			},
			h.dependencies,
		);
		expect(h.searches).toEqual([]);
	});
	it("performs requested latest-context search and records the observed native call", async () => {
		const h = harness();
		const result = await draftReport(
			input("Compare sources and find latest context."),
			h.dependencies,
		);
		expect(h.searches).toEqual(["Compare sources and find latest context."]);
		expect(result.events).toContainEqual({
			tool: "web_search_call",
			input: "Compare sources and find latest context.",
			status: "ok",
		});
		expect(result.supplemental).toEqual([{ url: "https://example.org/news" }]);
		expect(
			h.config?.tools?.map((t) => ("name" in t ? t.name : undefined)),
		).toContain("search_web");
	});
	it("preserves failed retrievals in the draft evidence and events", async () => {
		const h = harness();
		h.dependencies.read = async (url) => ({
			requestedUrl: url,
			status: "failed",
			error: "HTTP status 403",
		});
		const result = await draftReport(input(), h.dependencies);
		expect(result.events[0]).toEqual({
			tool: "read_url",
			input: urls[0],
			status: "failed",
			error: "HTTP status 403",
		});
		expect(h.prompt).toContain("HTTP status 403");
	});
	it("rejects missing report text", async () => {
		const h = harness();
		h.dependencies.createAgent = () => ({
			invoke: async () => ({ messages: [] }),
		});
		await expect(draftReport(input(), h.dependencies)).rejects.toThrow(
			/report/i,
		);
	});
	it("rejects a final tool result instead of treating source text as a report", async () => {
		const h = harness();
		h.dependencies.createAgent = () => ({
			invoke: async () => ({
				messages: [{ type: "tool", content: "Untrusted source text" }],
			}),
		});
		await expect(draftReport(input(), h.dependencies)).rejects.toThrow(
			/report/i,
		);
	});
	it("extracts text blocks from the final assistant message", async () => {
		const h = harness();
		h.dependencies.createAgent = () => ({
			invoke: async () => ({
				messages: [
					{
						type: "ai",
						content: [
							{ type: "text", text: "## Comparison\nA differs from B." },
						],
					},
				],
			}),
		});
		expect((await draftReport(input(), h.dependencies)).report).toBe(
			"## Comparison\nA differs from B.",
		);
	});
});
