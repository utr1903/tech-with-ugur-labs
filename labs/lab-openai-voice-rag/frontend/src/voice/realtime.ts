import { createProtocol } from "./protocol";
import { channelReady } from "./realtime-channel";
import type { Transport } from "./transport";

type Platform = {
	acquire(): Promise<MediaStream>;
	peer(): RTCPeerConnection;
	audio(): HTMLAudioElement;
	fetch: typeof fetch;
};
const browser: Platform = {
	acquire: () => navigator.mediaDevices.getUserMedia({ audio: true }),
	peer: () => new RTCPeerConnection(),
	audio: () => document.createElement("audio"),
	fetch: (...args) => fetch(...args),
};
export function createRealtime(
	platform: Platform = browser,
	observer?: { observe(stream: MediaStream): void; dispose(): void },
): Transport {
	let disposed = false;
	let stream: MediaStream | undefined;
	let peer: RTCPeerConnection | undefined;
	let channel: RTCDataChannel | undefined;
	let audio: HTMLAudioElement | undefined;
	const abort = new AbortController();
	let protocol: ReturnType<typeof createProtocol> | undefined;
	function dispose() {
		if (disposed) return;
		disposed = true;
		abort.abort();
		protocol?.dispose();
		observer?.dispose();
		channel?.close();
		peer?.close();
		for (const track of stream?.getTracks() ?? []) track.stop();
		if (audio) {
			audio.pause();
			audio.srcObject = null;
			audio.remove();
		}
		stream = undefined;
	}
	function send(event: unknown) {
		if (disposed) return;
		if (channel?.readyState !== "open") throw Error("Channel unavailable");
		channel.send(JSON.stringify(event));
	}
	function alive() {
		if (disposed) throw Error("Stopped");
	}
	function attach(
		acquired: MediaStream,
		call: Parameters<Transport["start"]>[1],
		fail: () => void,
		interrupt: () => void,
	) {
		stream = acquired;
		peer = platform.peer();
		audio = platform.audio();
		audio.autoplay = true;
		peer.ontrack = (e) => {
			if (!disposed && audio) {
				const remote = e.streams[0] ?? new MediaStream([e.track]);
				audio.srcObject = remote;
				try {
					observer?.observe(remote);
				} catch {
					/* Visualization must preserve playback. */
				}
				void audio.play().catch(fail);
			}
		};
		peer.onconnectionstatechange = () => {
			if (
				!disposed &&
				["failed", "disconnected"].includes(peer?.connectionState ?? "")
			)
				fail();
		};
		for (const track of stream.getTracks()) peer.addTrack(track, stream);
		channel = peer.createDataChannel("oai-events");
		protocol = createProtocol(send, call, fail, interrupt);
		channel.onmessage = (e) => {
			if (disposed) return;
			try {
				protocol?.event(JSON.parse(String(e.data)));
			} catch {
				fail();
			}
		};
		const channelFailure = () => {
			if (!disposed) fail();
		};
		channel.onclose = channelFailure;
		channel.onerror = channelFailure;
	}
	async function negotiate(clientSecret: string) {
		if (!peer || !channel) throw Error("Peer unavailable");
		const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]);
		const ready = channelReady(channel, signal);
		void ready.catch(() => {});
		const offer = await peer.createOffer();
		alive();
		await peer.setLocalDescription(offer);
		alive();
		const response = await platform.fetch(
			"https://api.openai.com/v1/realtime/calls",
			{
				method: "POST",
				body: offer.sdp,
				headers: {
					Authorization: `Bearer ${clientSecret}`,
					"Content-Type": "application/sdp",
				},
				signal,
			},
		);
		alive();
		if (!response.ok) throw Error("SDP negotiation failed");
		const sdp = await response.text();
		alive();
		await peer.setRemoteDescription({ type: "answer", sdp });
		alive();
		await ready;
		alive();
		send({
			type: "session.update",
			session: {
				type: "realtime",
				tools: [],
				tool_choice: "none",
				audio: {
					input: {
						transcription: {
							model: "gpt-4o-transcribe",
							prompt:
								"Transcribe verbatim. Preserve ordinary color and component names.",
						},
						turn_detection: {
							type: "server_vad",
							create_response: false,
							interrupt_response: false,
						},
					},
				},
			},
		});
	}
	async function start(
		token: Parameters<Transport["start"]>[0],
		call: Parameters<Transport["start"]>[1],
		fail: () => void,
		interrupt: () => void,
	) {
		try {
			if (!token.clientSecret) throw Error("Missing ephemeral credential");
			const acquired = await platform.acquire();
			if (disposed) {
				for (const track of acquired.getTracks()) track.stop();
				return;
			}
			attach(acquired, call, fail, interrupt);
			await negotiate(token.clientSecret);
		} catch (err) {
			if (disposed) return;
			dispose();
			throw err;
		}
	}

	return {
		start,
		dispose,
		say(text) {
			protocol?.say(text);
		},
		clearSpeech() {
			protocol?.clearSpeech();
		},
		question() {},
	};
}
