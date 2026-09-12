import { setTimeout as delay } from "node:timers/promises";
import type { SSEStreamingApi } from "hono/streaming";
import { abortable } from "../lib/abort.js";
import type { ThreadService } from "../threads/service.js";
export async function subscribe(
	service: ThreadService,
	stream: SSEStreamingApi,
	threadId: string,
	turnId: string,
	after: number,
) {
	const end = Date.now() + 305000;
	let sequence = after;
	let bytes = 0;
	const disconnected = new AbortController();
	stream.onAbort(() => disconnected.abort());
	while (!stream.aborted && Date.now() < end) {
		const events = await service.events(threadId, turnId, sequence);
		for (const event of events) {
			const data = JSON.stringify(event);
			bytes += Buffer.byteLength(data);
			if (bytes > 262144) throw new Error("Event budget reached.");
			await abortable(
				stream.writeSSE({ id: String(event.sequence), event: "chat", data }),
				AbortSignal.any([disconnected.signal, AbortSignal.timeout(5000)]),
			);
			sequence = event.sequence;
			if (event.type === "done" || event.type === "error") return;
		}
		const turn = await service.turn(threadId, turnId);
		if (turn?.status !== "active") return;
		await delay(100);
	}
}
