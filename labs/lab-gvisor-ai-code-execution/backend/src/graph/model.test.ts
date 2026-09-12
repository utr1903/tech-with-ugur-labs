import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it } from "vitest";
import { OpenAIModel } from "./model.js";

let server: Server | undefined;
afterEach(async () => {
	server?.closeAllConnections();
	if (server)
		await new Promise<void>((resolve) => server?.close(() => resolve()));
});
async function fixture(
	handler: (
		body: Record<string, unknown>,
		authorization: string | undefined,
	) => { status?: number; body: unknown } | null,
) {
	server = createServer(async (req, res) => {
		let body = "";
		for await (const data of req) body += data.toString();
		const result = handler(JSON.parse(body), req.headers.authorization);
		if (!result) return;
		res.writeHead(result.status ?? 200, { "content-type": "application/json" });
		res.end(JSON.stringify(result.body));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Fixture address missing.");
	return `http://127.0.0.1:${address.port}/v1`;
}
const response = (output: unknown[]) => ({
	id: "resp_fixture",
	object: "response",
	created_at: 1,
	status: "completed",
	output,
});
describe("OpenAI Responses wire contract without a live key", () => {
	it("sends strict bounded tool definitions and maps real function calls and outputs", async () => {
		const requests: Record<string, unknown>[] = [];
		const baseURL = await fixture((body, authorization) => {
			expect(authorization).toBe("Bearer fake-test-key");
			expect(JSON.stringify(body)).not.toContain("fake-test-key");
			requests.push(body);
			return {
				body: response(
					requests.length === 1
						? [
								{
									type: "function_call",
									call_id: "provider-id",
									name: "code_executor",
									arguments: '{"source":"print(42)"}',
								},
							]
						: [
								{
									type: "message",
									role: "assistant",
									content: [
										{ type: "output_text", text: "42", annotations: [] },
									],
								},
							],
				),
			};
		});
		const model = new OpenAIModel({
			apiKey: "fake-test-key",
			model: "gpt-4.1-mini",
			baseURL,
		});
		const first = await model.invoke(
			[new HumanMessage("calculate")],
			AbortSignal.timeout(2000),
		);
		expect(first.tool_calls?.[0]?.args).toEqual({ source: "print(42)" });
		const second = await model.invoke(
			[
				new HumanMessage("calculate"),
				new AIMessage({
					content: "",
					tool_calls: [
						{
							id: "stable-server-id",
							name: "code_executor",
							args: { source: "print(42)" },
						},
					],
				}),
				new ToolMessage({
					tool_call_id: "stable-server-id",
					content: '{"stdout":"42\\n"}',
				}),
			],
			AbortSignal.timeout(2000),
		);
		expect(second.content).toBe("42");
		expect(requests[0]).toMatchObject({
			parallel_tool_calls: false,
			max_output_tokens: 2048,
			store: false,
			tools: [
				{
					type: "function",
					name: "code_executor",
					strict: true,
					parameters: { additionalProperties: false, required: ["source"] },
				},
			],
		});
		expect(requests[1]?.input).toContainEqual({
			type: "function_call_output",
			call_id: "stable-server-id",
			output: '{"stdout":"42\\n"}',
		});
	});
	it("does not retry or expose reflected keys and provider error payloads", async () => {
		let requests = 0;
		const baseURL = await fixture(() => {
			requests++;
			return {
				status: 500,
				body: { error: { message: "fake-test-key secret-user-source" } },
			};
		});
		const model = new OpenAIModel({
			apiKey: "fake-test-key",
			model: "gpt-4.1-mini",
			baseURL,
		});
		await expect(
			model.invoke(
				[new HumanMessage("private-source")],
				AbortSignal.timeout(1000),
			),
		).rejects.toThrow("Model request failed.");
		expect(requests).toBe(1);
	});
	it("cancels stalled HTTP requests and rejects excessive provider payloads", async () => {
		let large = false;
		const baseURL = await fixture(() =>
			large
				? {
						body: response([
							{
								type: "message",
								role: "assistant",
								content: [{ type: "output_text", text: "x".repeat(131072) }],
							},
						]),
					}
				: null,
		);
		const model = new OpenAIModel({
			apiKey: "fake-test-key",
			model: "gpt-4.1-mini",
			baseURL,
		});
		await expect(
			model.invoke([new HumanMessage("stall")], AbortSignal.timeout(60)),
		).rejects.toThrow();
		large = true;
		await expect(
			model.invoke([new HumanMessage("large")], AbortSignal.timeout(1000)),
		).rejects.toThrow();
	});
});
