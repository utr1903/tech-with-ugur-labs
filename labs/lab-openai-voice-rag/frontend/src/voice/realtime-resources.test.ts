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
test("remote stream observation failure preserves playback and late tracks cannot restart it", async () => {
	const remote = {} as MediaStream;
	const microphone = { getTracks: () => [] } as unknown as MediaStream;
	const observer = {
		observe: vi.fn(() => {
			throw Error("Analysis unsupported");
		}),
		dispose: vi.fn(),
	};
	const audio = {
		play: vi.fn(async () => {}),
		pause: vi.fn(),
		remove: vi.fn(),
		srcObject: null as MediaStream | null,
	};
	const channel = Object.assign(new EventTarget(), {
		readyState: "open",
		send: vi.fn(),
		close: vi.fn(),
	});
	const peer = {
		ontrack: null as ((event: { streams: MediaStream[] }) => void) | null,
		addTrack: vi.fn(),
		createDataChannel: () => channel,
		createOffer: async () => ({ sdp: "offer" }),
		setLocalDescription: async () => {},
		setRemoteDescription: async () => {},
		close: vi.fn(),
	};
	const transport = createRealtime(
		{
			acquire: async () => microphone,
			peer: () => peer as unknown as RTCPeerConnection,
			audio: () => audio as unknown as HTMLAudioElement,
			fetch: vi.fn(async () => new Response("answer")),
		},
		observer,
	);
	const fail = vi.fn();
	await transport.start(token, () => {}, fail);
	peer.ontrack?.({ streams: [remote] });
	expect(audio.srcObject).toBe(remote);
	expect(audio.play).toHaveBeenCalledOnce();
	expect(observer.observe).toHaveBeenCalledExactlyOnceWith(remote);
	expect(fail).not.toHaveBeenCalled();
	transport.dispose();
	peer.ontrack?.({ streams: [remote] });
	expect(audio.play).toHaveBeenCalledOnce();
	expect(observer.dispose).toHaveBeenCalledOnce();
	expect(audio.srcObject).toBeNull();
});
