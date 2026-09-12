import { Hono } from "hono";
import { createGraph } from "../agent/graph.js";
import type { ChatStore } from "../chat/store.js";
import type { Evidence, Refresh } from "../corpus/types.js";
import type { Logger } from "../logger.js";
import type { AgentEvent, Provider } from "../provider/types.js";
import { SafeError, safeError } from "./errors.js";
import { agentBody } from "./routes.js";

type Options = {
	corpus: {
		retrieve: (question: string, signal?: AbortSignal) => Promise<Evidence>;
		ingest: () => Promise<Refresh>;
	};
	provider: Provider;
	chats?: ChatStore;
	logger: Logger;
	deadlineMs?: number;
	maxPending?: number;
	maxChats?: number;
};
export function createApp(options: Options) {
	const app = new Hono();
	const graph = options.chats
		? createGraph({
				...options,
				chats: options.chats,
				retrieve: options.corpus.retrieve,
			})
		: undefined;
	app.onError((err, c) => {
		const safe = safeError(err);
		options.logger.error({ err: safe }, "HTTP operation failed.");
		return c.json({ error: safe.message }, safe.status);
	});
	app.get("/api/ready", (c) =>
		c.json({ ready: true, mode: options.provider.mode }),
	);
	app.post("/api/realtime/token", async (c) => {
		const clientSecret = await options.provider.secret(
			AbortSignal.timeout(30000),
		);
		return c.json({
			mode: options.provider.mode,
			...(clientSecret ? { clientSecret } : {}),
		});
	});
	app.post("/api/agent", async (c) => {
		const body = await agentBody(c);
		if (!graph) throw new SafeError("Chat storage unavailable", 502);
		const controller = new AbortController();
		const signal = AbortSignal.any([controller.signal, c.req.raw.signal]);
		const encoder = new TextEncoder();
		let closed = false;
		let emit: (event: AgentEvent) => void = () => {};
		let close = () => {};
		const stream = new ReadableStream<Uint8Array>({
			start(out) {
				emit = (event) => {
					if (!closed)
						out.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				};
				close = () => {
					if (!closed) {
						closed = true;
						out.close();
					}
				};
			},
			cancel() {
				closed = true;
				controller.abort(new SafeError("Turn cancelled", 502));
			},
		});
		try {
			const work = graph.turn(body.sessionId, body.query, emit, signal);
			void work
				.catch((err) => {
					if (!signal.aborted)
						emit({ type: "error", message: safeError(err).message });
				})
				.finally(close);
		} catch (err) {
			close();
			throw err;
		}

		return new Response(stream, {
			headers: {
				"Content-Type": "application/x-ndjson",
				"Cache-Control": "no-store",
				"X-Accel-Buffering": "no",
			},
		});
	});
	app.post("/api/ingest", async (c) => c.json(await options.corpus.ingest()));
	return app;
}
