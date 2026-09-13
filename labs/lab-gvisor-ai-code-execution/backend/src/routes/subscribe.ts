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
		// A terminal status is committed with its event. Read status first so the
		// subsequent event query sees that commit; keep draining bounded pages.
		const turn = await service.turn(threadId, turnId);
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
		if (turn?.status !== "active" && events.length === 0) return;
		await delay(100);
	}
}
