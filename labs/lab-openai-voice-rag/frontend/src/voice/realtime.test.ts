import { expect, test, vi } from "vitest";
import { createProtocol } from "./protocol";

test("canonical transcription passes unchanged and duplicates are ignored", () => {
	const call = vi.fn();
	const p = createProtocol(
		() => {},
		call,
		() => {},
		() => {},
	);
	p.event({ type: "input_audio_buffer.committed", item_id: "a" });
	p.event({
		type: "conversation.item.input_audio_transcription.completed",
		item_id: "a",
		transcript: "What is the amber valve recovery code?",
	});
	p.event({
		type: "conversation.item.input_audio_transcription.completed",
		item_id: "a",
		transcript: "duplicate",
	});
	expect(call).toHaveBeenCalledExactlyOnceWith({
		id: "a",
		question: "What is the amber valve recovery code?",
	});
});
test("speech waits for matching playback stopped rather than response done", () => {
	const send = vi.fn();
	const p = createProtocol(
		send,
		() => {},
		() => {},
		() => {},
	);
	p.say("First.");
	p.say("Second.");
	const metadata = send.mock.calls[0]?.[0].response.metadata;
	p.event({ type: "response.created", response: { id: "r1", metadata } });
	p.event({
		type: "response.done",
		response: { id: "r1", status: "completed" },
	});
	expect(send).toHaveBeenCalledTimes(1);
	p.event({ type: "output_audio_buffer.stopped", response_id: "other" });
	expect(send).toHaveBeenCalledTimes(1);
	p.event({ type: "output_audio_buffer.stopped", response_id: "r1" });
	expect(send).toHaveBeenCalledTimes(2);
	p.dispose();
});

test("out-of-order transcription and obsolete speech events cannot cross turns", () => {
	const send = vi.fn(),
		call = vi.fn(),
		interrupt = vi.fn();
	const p = createProtocol(send, call, () => {}, interrupt);
	p.event({ type: "input_audio_buffer.committed", item_id: "old" });
	p.event({ type: "input_audio_buffer.speech_started" });
	p.event({ type: "input_audio_buffer.committed", item_id: "new" });
	p.event({
		type: "conversation.item.input_audio_transcription.completed",
		item_id: "old",
		transcript: "stale",
	});
	p.event({
		type: "conversation.item.input_audio_transcription.completed",
		item_id: "new",
		transcript: "fresh",
	});
	expect(call).toHaveBeenCalledExactlyOnceWith({
		id: "new",
		question: "fresh",
	});
	expect(interrupt).toHaveBeenCalledOnce();
	p.say("Old.");
	const oldMetadata = send.mock.calls.at(-1)?.[0].response.metadata;
	p.event({
		type: "response.created",
		response: { id: "old-response", metadata: oldMetadata },
	});
	p.clearSpeech();
	p.say("New.");
	p.say("Queued.");
	const newMetadata = send.mock.calls.at(-1)?.[0].response.metadata;
	p.event({
		type: "response.created",
		response: { id: "new-response", metadata: newMetadata },
	});
	const count = send.mock.calls.length;
	for (const type of [
		"response.done",
		"output_audio_buffer.stopped",
		"output_audio_buffer.cleared",
	]) {
		p.event({
			type,
			response_id: "old-response",
			response: { id: "old-response", status: "completed" },
		});
	}
	expect(send).toHaveBeenCalledTimes(count);
	p.event({ type: "output_audio_buffer.stopped", response_id: "new-response" });
	expect(send).toHaveBeenCalledTimes(count + 1);
	p.dispose();
});
