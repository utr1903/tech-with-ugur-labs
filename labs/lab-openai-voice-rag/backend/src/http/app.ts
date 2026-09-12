import { Hono } from "hono";
import { createGraph } from "../agent/graph.js";
import type { Evidence, Refresh } from "../corpus/types.js";
import type { Logger } from "../logger.js";
import type { Provider } from "../provider/types.js";
import { safeError } from "./errors.js";
import { agentBody } from "./routes.js";

type Options = {
	corpus: {
		retrieve: (question: string, signal?: AbortSignal) => Promise<Evidence>;
		ingest: () => Promise<Refresh>;
	};
	provider: Provider;
	logger: Logger;
};
export function createApp(options: Options) {
	const app = new Hono();
	const graph = createGraph({ ...options, retrieve: options.corpus.retrieve });
	app.onError((err, context) => {
		const safe = safeError(err);
		options.logger.error({ err: safe }, "HTTP operation failed.");
		return context.json({ error: safe.message }, safe.status);
	});
	app.get("/api/ready", (context) =>
		context.json({ ready: true, mode: options.provider.mode }),
	);
	app.post("/api/realtime/token", async (context) => {
		const conversationId = await graph.create();
		try {
			const clientSecret = await options.provider.secret(
				AbortSignal.timeout(30000),
			);
			return context.json({
				mode: options.provider.mode,
				conversationId,
				...(clientSecret ? { clientSecret } : {}),
			});
		} catch (err) {
			graph.remove(conversationId);
			throw safeError(err);
		}
	});
	app.post("/api/agent", async (context) => {
		const body = await agentBody(context);
		return context.json(await graph.turn(body.conversationId, body.question));
	});
	app.post("/api/ingest", async (context) =>
		context.json(await options.corpus.ingest()),
	);
	return app;
}
