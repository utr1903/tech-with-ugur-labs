import { expect, test } from "vitest";
import { channelReady } from "./realtime-channel";

test("channel readiness resolves open and rejects interruption", async () => {
	const open = Object.assign(new EventTarget(), { readyState: "open" });
	await expect(
		channelReady(open as RTCDataChannel, new AbortController().signal),
	).resolves.toBeUndefined();
	const connecting = Object.assign(new EventTarget(), {
		readyState: "connecting",
	});
	const abort = new AbortController();
	const pending = channelReady(connecting as RTCDataChannel, abort.signal);
	abort.abort();
	await expect(pending).rejects.toThrow("Connection interrupted");
});
