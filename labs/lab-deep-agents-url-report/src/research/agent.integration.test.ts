import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent } from "deepagents";
import OpenAI from "openai";
import pino from "pino";
import { expect, it } from "vitest";
import { draftReport } from "./agent.js";

it("enforces filesystem permissions in a real graph with mocked model HTTP", async () => {
	const root = await mkdtemp(join(tmpdir(), "report-agent-"));
	await mkdir(join(root, "input"));
	await mkdir(join(root, "output"));
	await writeFile(join(root, "input", "notes.txt"), "original");
	const requests: {
		tools: { function: { name: string } }[];
		messages: { role: string; content: string }[];
	}[] = [];
	try {
		const result = await draftReport(
			{
				instruction: "Compare the sources.",
				requestedUrls: [],
				notes: [],
				workspaceDir: root,
				model: "gpt-4.1-mini",
				client: new OpenAI({ apiKey: "test" }),
				logger: pino({ level: "silent" }),
			},
			{
				createAgent: (options) =>
					createDeepAgent({
						...options,
						model: new ChatOpenAI({
							model: "gpt-4.1-mini",
							apiKey: "test",
							configuration: {
								fetch: async (_url, init) => {
									requests.push(JSON.parse(String(init?.body)));
									const toolCalls = [
										{
											id: "input_write",
											type: "function",
											function: {
												name: "write_file",
												arguments: JSON.stringify({
													file_path: "/input/notes.txt",
													content: "changed",
												}),
											},
										},
										{
											id: "output_write",
											type: "function",
											function: {
												name: "write_file",
												arguments: JSON.stringify({
													file_path: "/output/notes.txt",
													content: "working notes",
												}),
											},
										},
										{
											id: "outside_read",
											type: "function",
											function: {
												name: "read_file",
												arguments: JSON.stringify({ file_path: "/secret.txt" }),
											},
										},
									];
									return Response.json({
										id: `chatcmpl_test_${requests.length}`,
										object: "chat.completion",
										created: 1,
										model: "gpt-4.1-mini",
										choices: [
											{
												index: 0,
												finish_reason:
													requests.length === 1 ? "tool_calls" : "stop",
												message:
													requests.length === 1
														? {
																role: "assistant",
																content: null,
																tool_calls: toolCalls,
															}
														: {
																role: "assistant",
																content: "## Comparison\nNo requested sources.",
															},
											},
										],
										usage: {
											prompt_tokens: 10,
											completion_tokens: 10,
											total_tokens: 20,
										},
									});
								},
							},
						}),
					}),
			},
		);
		expect(result.report).toContain("Comparison");
		expect(await readFile(join(root, "input", "notes.txt"), "utf8")).toBe(
			"original",
		);
		expect(await readFile(join(root, "output", "notes.txt"), "utf8")).toBe(
			"working notes",
		);
		const names = requests[0].tools.map((t) => t.function.name);
		expect(names).toContain("write_todos");
		expect(names).not.toContain("execute");
		expect(names).not.toContain("shell");
		const responses = requests[1].messages.filter((m) => m.role === "tool");
		expect(responses.filter((m) => /denied/i.test(m.content))).toHaveLength(2);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
