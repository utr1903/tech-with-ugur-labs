import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent } from "deepagents";
import OpenAI from "openai";
import pino from "pino";
import { expect, test } from "vitest";
import { draftReport } from "./agent.js";

// Real graph and filesystem; only the external model HTTP boundary is replaced.
test("agent file reads expose only approved direct input and nonprivate output", async () => {
	const root = await mkdtemp(join(tmpdir(), "report-input-access-"));
	const blocked = [
		"input/data.json",
		"input/nested/note.md",
		"input/unapproved.md",
		...["input", "output", "output/nested"].flatMap((dir) =>
			[".env", ".env.local", ".env.test.local", "x_private.md"].map(
				(name) => `${dir}/${name}`,
			),
		),
	];
	const blockedReads = [...blocked, "output/linked/note.md"];
	const allowed = [
		"input/notes.txt",
		"input/context.md",
		"input/urls.txt",
		"output/notes.txt",
	];
	const requests: {
		messages: { role: string; content: string; tool_call_id?: string }[];
	}[] = [];
	try {
		for (const dir of ["input/nested", "output/nested"])
			await mkdir(join(root, dir), { recursive: true });
		for (const file of blocked)
			await writeFile(join(root, file), "BLOCKED_CONTENT_SENTINEL");
		await symlink(join(root, "input/nested"), join(root, "output/linked"));
		for (const file of allowed)
			await writeFile(join(root, file), "ALLOWED_CONTENT_SENTINEL");
		await draftReport(
			{
				instruction: "Summarize notes",
				requestedUrls: [],
				notes: [
					{ name: "notes.txt", text: "Context" },
					{ name: "context.md", text: "Context" },
				],
				workspaceDir: root,
				model: "gpt-4.1-mini",
				client: new OpenAI({ apiKey: "test" }),
				logger: pino({ enabled: false }),
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
									return Response.json({
										id: `test_${requests.length}`,
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
																tool_calls: [...blockedReads, ...allowed].map(
																	(file, index) => ({
																		id: `read_${index}`,
																		type: "function",
																		function: {
																			name: "read_file",
																			arguments: JSON.stringify({
																				file_path: `/${file}`,
																			}),
																		},
																	}),
																),
															}
														: { role: "assistant", content: "# Summary" },
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
		const responses = requests[1].messages.filter(
			(message) => message.role === "tool",
		);
		for (let index = 0; index < blockedReads.length; index++) {
			const response = responses.find(
				(message) => message.tool_call_id === `read_${index}`,
			);
			expect(JSON.stringify(response?.content), blockedReads[index]).toMatch(
				/denied/i,
			);
			expect(JSON.stringify(response?.content)).not.toContain(
				"BLOCKED_CONTENT_SENTINEL",
			);
		}
		for (
			let index = blockedReads.length;
			index < blockedReads.length + allowed.length;
			index++
		) {
			expect(
				JSON.stringify(
					responses.find((message) => message.tool_call_id === `read_${index}`)
						?.content,
				),
				allowed[index - blockedReads.length],
			).toContain("ALLOWED_CONTENT_SENTINEL");
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
