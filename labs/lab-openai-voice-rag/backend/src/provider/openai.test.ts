import OpenAI from "openai";
import { expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { createEmbedding } from "./embedding.js";

const logger = createLogger({ appName: "provider-test" });
logger.level = "silent";

import { createOpenAIProvider } from "./openai.js";

it("uses the managed session API and preserves tool correlations", async () => {
	const requests: { url: string; body: Record<string, unknown> }[] = [];
	const fetcher: typeof fetch = async (input, init) => {
		const url = String(input);
		const body = JSON.parse(String(init?.body ?? "{}"));
		if (init?.method === "DELETE") {
			requests.push({ url, body: { delete: true } });
			return Response.json({ id: "managed1", deleted: true });
		}
		requests.push({ url, body });
		if (url.endsWith("/items?order=asc&limit=100"))
			return Response.json({
				object: "list",
				data: [
					{
						type: "message",
						turn_id: "t1",
						role: "assistant",
						phase: "final_answer",
						status: "completed",
						content: [{ type: "output_text", text: "ORCHID-47" }],
					},
				],
				has_more: false,
			});
		if (url.endsWith("/events") && init?.method === "POST")
			return new Response(null, { status: 204 });
		const event = url.endsWith("/sessions")
			? {
					type: "agent.session.requires_action",
					session: {
						id: "managed1",
						required_actions: [
							{
								type: "function_call",
								turn_id: "t1",
								call_id: "c1",
								name: "retrieve_documents",
								arguments: { question: "amber" },
							},
						],
					},
				}
			: {
					type: "agent.session.turn.completed",
					session_id: "managed1",
					turn_id: "t1",
				};
		return new Response(
			`data: ${JSON.stringify(event)}\n\ndata: ${JSON.stringify({ type: "agent.session.turn.completed", session_id: "managed1", turn_id: "t1" })}\n\ndata: [DONE]\n\n`,
			{ headers: { "content-type": "text/event-stream" } },
		);
	};
	const provider = createOpenAIProvider(
		new OpenAI({ apiKey: "fixture-key", fetch: fetcher, maxRetries: 0 }),
		logger,
	);
	const session = provider.create();
	const signal = new AbortController().signal;
	const pending = await session.turn("amber", signal);
	expect(pending.type).toBe("pending");
	if (pending.type !== "pending") throw Error("missing action");
	expect(
		await session.output(
			pending.calls[0] ??
				(() => {
					throw Error("missing call");
				})(),
			{ sources: [], context: "ORCHID-47" },
			signal,
		),
	).toEqual({ type: "final", answer: "ORCHID-47" });
	expect(requests[0]?.body).toMatchObject({
		environment: { type: "none" },
		stream: true,
		agent: { model: "gpt-6-astra" },
	});
	expect(requests.find((request) => request.body.events)?.body).toMatchObject({
		events: [
			{
				type: "agent.session.input.tool_result",
				turn_id: "t1",
				call_id: "c1",
				success: true,
			},
		],
	});
	expect(await session.turn("follow up", signal)).toEqual({
		type: "final",
		answer: "ORCHID-47",
	});
	expect(
		requests.filter((request) => request.url.endsWith("/sessions")),
	).toHaveLength(1);
	const subscription = requests.findIndex(
		(request) =>
			request.url.endsWith("/managed1/events") && !request.body.events,
	);
	const followUp = requests.findIndex(
		(request) =>
			Array.isArray(request.body.events) &&
			(request.body.events[0] as { type: string }).type ===
				"agent.session.input.message",
	);
	expect(subscription).toBeGreaterThan(-1);
	expect(followUp).toBeGreaterThan(subscription);

	expect(requests.filter((request) => request.body.delete)).toHaveLength(0);
	session.close();
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(
		requests.some(
			(request) => request.url.endsWith("/managed1") && request.body.delete,
		),
	).toBe(true);
});
it("bounds embedding batches and requests 1536 dimensions", async () => {
	const sizes: number[] = [];
	const client = new OpenAI({
		apiKey: "fixture-key",
		fetch: async (_input, init) => {
			const body = JSON.parse(String(init?.body));
			sizes.push(body.input.length);
			expect(body.dimensions).toBe(1536);
			return Response.json({
				data: body.input.map((_text: string, index: number) => ({
					index,
					embedding: Array(1536).fill(0),
				})),
			});
		},
	});
	expect(await createEmbedding(client)(Array(70).fill("amber"))).toHaveLength(
		70,
	);
	expect(Math.max(...sizes)).toBeLessThanOrEqual(32);
});
it("routes Realtime tools and reads the top-level ephemeral value", async () => {
	const client = new OpenAI({
		apiKey: "YOUR_OPENAI_API_KEY",
		fetch: async (input, init) => {
			expect(String(input)).toContain("/realtime/client_secrets");
			expect(JSON.parse(String(init?.body))).toMatchObject({
				session: {
					type: "realtime",
					model: "gpt-realtime-2.1",
					tools: [{ name: "ask_knowledge_base" }],
				},
			});
			return Response.json({
				value: "ephemeral-fixture",
				expires_at: 1,
				session: {},
			});
		},
	});
	expect(
		await createOpenAIProvider(client, logger).secret(
			new AbortController().signal,
		),
	).toBe("ephemeral-fixture");
});
it("withholds raw SDK errors at all live boundaries", async () => {
	const client = new OpenAI({
		apiKey: "fixture-key",
		maxRetries: 0,
		fetch: async () => {
			throw Error("sk-permanent-provider-private");
		},
	});
	const provider = createOpenAIProvider(client, logger);
	const signal = new AbortController().signal;
	await expect(provider.secret(signal)).rejects.toThrow(
		"Voice session creation failed",
	);
	await expect(provider.create().turn("amber", signal)).rejects.toThrow(
		"Managed turn failed",
	);
	await expect(createEmbedding(client)(["amber"], signal)).rejects.toThrow(
		"Embedding operation failed",
	);
});
