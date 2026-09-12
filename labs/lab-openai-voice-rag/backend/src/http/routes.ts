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
		!("conversationId" in body) ||
		typeof body.conversationId !== "string" ||
		body.conversationId.length > 100 ||
		!("question" in body) ||
		typeof body.question !== "string" ||
		!body.question.trim() ||
		body.question.length > 2000
	)
		throw new SafeError("Invalid agent request", 400);
	return {
		conversationId: body.conversationId,
		question: body.question.trim(),
	};
}
