import { expect, test, vi } from "vitest";
import { createRealtime } from "./realtime";

function deferred<T>() {
	let resolve!: (x: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
const token = {
	mode: "live" as const,
	conversationId: "a",
	clientSecret: "YOUR_EPHEMERAL_KEY",
};
test("late live microphone is stopped before peer allocation", async () => {
	const d = deferred<MediaStream>();
	const stop = vi.fn();
	const peer = vi.fn();
	const t = createRealtime({
		acquire: () => d.promise,
		peer,
		audio: vi.fn(),
		fetch: vi.fn(),
	});
	const pending = t.start(
		token,
		() => {},
		() => {},
	);
	t.dispose();
	d.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
	await pending;
	expect(stop).toHaveBeenCalledOnce();
	expect(peer).not.toHaveBeenCalled();
});
test("Stop during SDP disposes peer/channel/audio and ignores late answer", async () => {
	const stop = vi.fn();
	const close = vi.fn();
	const channel = Object.assign(new EventTarget(), {
		readyState: "connecting",
		close: vi.fn(),
		send: vi.fn(),
	});
	const remote = vi.fn();
	const peer = {
		addTrack: vi.fn(),
		createDataChannel: () => channel,
		createOffer: async () => ({ sdp: "offer" }),
		setLocalDescription: async () => {},
		setRemoteDescription: remote,
		close,
	};
	const audio = { pause: vi.fn(), remove: vi.fn(), srcObject: null };
	const d = deferred<Response>();
	const fetch = vi.fn(() => d.promise);
	const t = createRealtime({
		acquire: async () =>
			({ getTracks: () => [{ stop }] }) as unknown as MediaStream,
		peer: () => peer as unknown as RTCPeerConnection,
		audio: () => audio as unknown as HTMLAudioElement,
		fetch,
	});
	const pending = t.start(
		token,
		() => {},
		() => {},
	);
	await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
	t.dispose();
	d.resolve(new Response("answer"));
	await pending;
	expect(stop).toHaveBeenCalledOnce();
	expect(close).toHaveBeenCalledOnce();
	expect(channel.close).toHaveBeenCalledOnce();
	expect(audio.pause).toHaveBeenCalledOnce();
	expect(remote).not.toHaveBeenCalled();
});
