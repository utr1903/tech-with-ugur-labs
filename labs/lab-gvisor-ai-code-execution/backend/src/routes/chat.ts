import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { abortable } from "../lib/abort.js";
import type { ThreadService } from "../threads/service.js";
import { subscribe } from "./subscribe.js";
export function chatRoutes(app: Hono, service: ThreadService) {
	let streams = 0;
	app.post("/threads/:id/chat", async (c) => {
		if (streams >= 16)
			return c.json({ error: "Connection limit reached." }, 429);
		const after = Number(c.req.header("Last-Event-ID") ?? 0);
		if (!Number.isSafeInteger(after) || after < 0)
			return c.json({ error: "Invalid event cursor." }, 400);
		streams++;
		try {
			const request = JSON.parse(await boundedBody(c.req.raw));
			const threadId = c.req.param("id");
			await service.start(threadId, request);
			return streamSSE(
				c,
				async (stream) => {
					try {
						await subscribe(service, stream, threadId, request.turnId, after);
					} finally {
						streams--;
					}
				},
				async () => {},
			);
		} catch (err) {
			streams--;
			throw err;
		}
	});
}
async function boundedBody(request: Request) {
	const reader = request.body?.getReader();
	if (!reader) throw new Error("Missing body.");
	const chunks: Uint8Array[] = [];
	let length = 0;
	const deadline = AbortSignal.timeout(5000);
	try {
		for (;;) {
			const { done, value } = await abortable(reader.read(), deadline);
			if (done) break;
			length += value.byteLength;
			if (length > 131072) throw new Error("Body too large.");
			chunks.push(value);
		}
		return Buffer.concat(chunks).toString("utf8");
	} finally {
		void reader.cancel().catch(() => {});
	}
}
