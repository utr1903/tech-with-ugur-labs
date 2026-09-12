import { expect, test, vi } from "vitest";
import { createSpeechQueue } from "./speech-queue";

test("late creation cancels the interrupted phrase before replacement playback", () => {
	const send = vi.fn(),
		fail = vi.fn();
	const q = createSpeechQueue(send, fail);
	q.say("Old answer.");
	const oldMetadata = send.mock.calls[0]?.[0].response.metadata;
	q.clear();
	q.say("Discarded replacement.");
	q.clear();
	q.say("New answer.");
	q.say("Next phrase.");
	q.event({
		type: "response.created",
		response: { id: "unrelated", metadata: { phrase_id: "other" } },
	});
	expect(
		send.mock.calls.filter(([e]) => e.type === "response.create"),
	).toHaveLength(1);
	expect(
		send.mock.calls.filter(([e]) => e.type === "response.cancel"),
	).toHaveLength(0);
	q.event({
		type: "response.created",
		response: { id: "old-response", metadata: oldMetadata },
	});
	const cancellation = send.mock.calls.find(
		([e]) => e.type === "response.cancel",
	)?.[0];
	expect(cancellation).toMatchObject({ response_id: "old-response" });
	expect(send.mock.calls.slice(-3).map(([e]) => e.type)).toEqual([
		"response.cancel",
		"output_audio_buffer.clear",
		"response.create",
	]);
	const replacement = send.mock.calls.at(-1)?.[0];
	expect(replacement.response.input[0].content[0].text).toBe("New answer.");
	q.event({
		type: "response.created",
		response: { id: "new-response", metadata: replacement.response.metadata },
	});
	q.event({
		type: "error",
		error: {
			event_id: cancellation.event_id,
			code: "response_cancel_not_active",
		},
	});
	const before = send.mock.calls.length;
	q.event({
		type: "response.created",
		response: { id: "old-response", metadata: oldMetadata },
	});
	q.event({
		type: "response.done",
		response: { id: "old-response", status: "cancelled" },
	});
	q.event({ type: "output_audio_buffer.stopped", response_id: "old-response" });
	q.event({
		type: "response.done",
		response: { id: "new-response", status: "completed" },
	});
	expect(send).toHaveBeenCalledTimes(before);
	expect(fail).not.toHaveBeenCalled();
	q.event({ type: "output_audio_buffer.stopped", response_id: "new-response" });
	expect(send.mock.calls.at(-1)?.[0].response.input[0].content[0].text).toBe(
		"Next phrase.",
	);
	q.dispose();
});

test("missing interrupted creation expires without starting replacement speech", () => {
	vi.useFakeTimers();
	const send = vi.fn(),
		fail = vi.fn();
	const q = createSpeechQueue(send, fail);
	try {
		q.say("Old answer.");
		const metadata = send.mock.calls[0]?.[0].response.metadata;
		vi.advanceTimersByTime(10000);
		q.clear();
		q.say("Discarded replacement.");
		vi.advanceTimersByTime(10000);
		q.clear();
		q.say("New answer.");
		vi.advanceTimersByTime(9999);
		expect(fail).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(fail).toHaveBeenCalledOnce();
		q.event({
			type: "response.created",
			response: { id: "too-late", metadata },
		});
		expect(send).toHaveBeenCalledOnce();
	} finally {
		q.dispose();
		vi.useRealTimers();
	}
});
