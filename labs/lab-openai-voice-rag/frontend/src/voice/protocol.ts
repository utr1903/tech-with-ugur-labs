import { createSpeechQueue } from "./speech-queue";
import type { Call } from "./transport";
export function createProtocol(
	send: (event: unknown) => void,
	call: (call: Call) => void,
	fail: () => void,
	interrupt: () => void,
) {
	const speech = createSpeechQueue(send, fail);
	const seen = new Set<string>();
	let latest: string | undefined;
	function transcript(e: Record<string, unknown>) {
		if (
			typeof e.item_id !== "string" ||
			e.item_id !== latest ||
			seen.has(e.item_id)
		)
			return;
		seen.add(e.item_id);
		if (
			typeof e.transcript !== "string" ||
			!e.transcript.trim() ||
			e.transcript.length > 2000
		)
			return;
		call({ id: e.item_id, question: e.transcript });
	}
	function event(input: unknown) {
		if (!input || typeof input !== "object") return;
		const e = input as Record<string, unknown>;
		if (e.type === "input_audio_buffer.speech_started") {
			latest = undefined;
			speech.clear();
			interrupt();
			return;
		}
		if (
			e.type === "input_audio_buffer.committed" &&
			typeof e.item_id === "string"
		) {
			latest = e.item_id;
			return;
		}
		if (e.type === "conversation.item.input_audio_transcription.completed") {
			transcript(e);
			return;
		}
		speech.event(e);
	}
	return {
		event,
		say: speech.say,
		clearSpeech: speech.clear,
		dispose: speech.dispose,
	};
}
