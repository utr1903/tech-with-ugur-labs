import type { Context } from "hono";
import { SafeError } from "./errors.js";
export async function agentBody(context: Context) {
	const reader = context.req.raw.body?.getReader();
	if (!reader) throw new SafeError("Invalid JSON body", 400);
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;
		bytes += chunk.value.length;
		if (bytes > 8192) {
			await reader.cancel();
			throw new SafeError("Request body too large", 400);
		}
		chunks.push(chunk.value);
	}
	const buffer = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		buffer.set(chunk, offset);
		offset += chunk.length;
	}
	let body: unknown;
	try {
		body = JSON.parse(new TextDecoder().decode(buffer));
	} catch {
		throw new SafeError("Invalid JSON body", 400);
	}
	if (
		!body ||
		typeof body !== "object" ||
		!("sessionId" in body) ||
		typeof body.sessionId !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			body.sessionId,
		) ||
		!("query" in body) ||
		typeof body.query !== "string" ||
		!body.query.trim() ||
		body.query.length > 2000
	)
		throw new SafeError("Invalid agent request", 400);
	return {
		sessionId: body.sessionId.toLowerCase(),
		query: body.query.trim(),
	};
}
