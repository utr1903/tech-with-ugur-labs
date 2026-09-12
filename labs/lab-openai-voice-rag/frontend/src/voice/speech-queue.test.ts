import { expect, test, vi } from "vitest";
import { createSpeechQueue } from "./speech-queue";

test("timeout ends connection instead of overlapping unknown playback", () => {
	vi.useFakeTimers();
	const send = vi.fn(),
		fail = vi.fn();
	const q = createSpeechQueue(send, fail);
	q.say("First.");
	q.say("Second.");
	vi.advanceTimersByTime(30000);
	expect(fail).toHaveBeenCalledOnce();
	expect(send).toHaveBeenCalledOnce();
	q.dispose();
	vi.useRealTimers();
});
test("own cancel race is tolerated, unrelated errors still fail", () => {
	const send = vi.fn(),
		fail = vi.fn();
	const q = createSpeechQueue(send, fail);
	q.say("First.");
	q.clear();
	const cancel = send.mock.calls.find(
		([e]) => e.type === "response.cancel",
	)?.[0];
	q.event({
		type: "error",
		error: { event_id: cancel.event_id, code: "response_cancel_not_active" },
	});
	expect(fail).not.toHaveBeenCalled();
	q.event({
		type: "error",
		error: { event_id: "other", code: "response_cancel_not_active" },
	});
	expect(fail).toHaveBeenCalledOnce();
	q.dispose();
});

test("delayed own errors from two interrupted phrases preserve current playback", () => {
	const send = vi.fn(),
		fail = vi.fn();
	const q = createSpeechQueue(send, fail);
	for (const [index, text] of ["First.", "Second."].entries()) {
		q.say(text);
		const created = send.mock.calls.at(-1)?.[0];
		q.event({
			type: "response.created",
			response: {
				id: `interrupted-${index}`,
				metadata: created.response.metadata,
			},
		});
		q.clear();
	}
	const cancellations = send.mock.calls
		.filter(([e]) => e.type === "response.cancel")
		.map(([e]) => e);
	expect(cancellations).toHaveLength(2);
	expect(cancellations[0].event_id).not.toBe(cancellations[1].event_id);
	q.say("Third.");
	const created = send.mock.calls.at(-1)?.[0];
	q.event({
		type: "response.created",
		response: { id: "current", metadata: created.response.metadata },
	});
	q.say("Fourth.");
	for (const cancel of cancellations) {
		q.event({
			type: "error",
			error: { event_id: cancel.event_id, code: "response_cancel_not_active" },
		});
		expect(fail).not.toHaveBeenCalled();
	}
	const before = send.mock.calls.filter(
		([e]) => e.type === "response.create",
	).length;
	q.event({ type: "output_audio_buffer.stopped", response_id: "current" });
	expect(
		send.mock.calls.filter(([e]) => e.type === "response.create"),
	).toHaveLength(before + 1);
	q.dispose();
});
