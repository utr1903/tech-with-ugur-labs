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
