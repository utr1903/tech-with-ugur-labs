import type { Page } from "@playwright/test";

type Telemetry = {
	events: Record<string, unknown>[];
	sent: Record<string, unknown>[];
	tracks: MediaStreamTrack[];
	recordings: Blob[];
	recorders: MediaRecorder[];
	firstRecordedAudioAt?: number;
	agent: {
		sessionId: string;
		query: string;
		startedAt: number;
		frames: { at: number; event: Record<string, unknown> }[];
		error?: string;
	}[];
};
declare global {
	interface Window {
		liveTelemetry: Telemetry;
	}
}
export async function installTelemetry(page: Page) {
	await page.addInitScript(() => {
		const telemetry: Telemetry = {
			events: [],
			sent: [],
			tracks: [],
			recordings: [],
			recorders: [],
			agent: [],
		};
		const Native = window.RTCPeerConnection;
		window.RTCPeerConnection = class extends Native {
			constructor(config?: RTCConfiguration) {
				super(config);
				this.addEventListener("track", (event) => {
					const stream = event.streams[0] ?? new MediaStream([event.track]);
					const recorder = new MediaRecorder(stream, {
						mimeType: "audio/webm;codecs=opus",
					});
					recorder.addEventListener("dataavailable", (e) => {
						if (e.data.size) {
							telemetry.firstRecordedAudioAt ??= performance.now();
							telemetry.recordings.push(e.data);
						}
					});
					telemetry.recorders.push(recorder);
					recorder.start(250);
				});
			}
			createDataChannel(label: string, options?: RTCDataChannelInit) {
				const channel = super.createDataChannel(label, options);
				const send = channel.send.bind(channel);
				channel.send = ((data: string) => {
					telemetry.sent.push({
						...JSON.parse(data),
						observedAt: performance.now(),
					});
					send(data);
				}) as typeof channel.send;
				channel.addEventListener("message", (e) =>
					telemetry.events.push({
						...JSON.parse(String(e.data)),
						observedAt: performance.now(),
					}),
				);
				return channel;
			}
		};
		function consume(buffer: string, turn: Telemetry["agent"][number]) {
			let n = buffer.indexOf("\n");
			while (n >= 0) {
				turn.frames.push({
					at: performance.now(),
					event: JSON.parse(buffer.slice(0, n)),
				});
				buffer = buffer.slice(n + 1);
				n = buffer.indexOf("\n");
			}
			return buffer;
		}
		async function captureStream(
			response: Response,
			turn: Telemetry["agent"][number],
		) {
			const reader = response.clone().body?.getReader();
			if (!reader) return;
			const decoder = new TextDecoder();
			let buffer = "";

			try {
				while (true) {
					const part = await reader.read();
					if (part.done) break;
					buffer += decoder.decode(part.value, { stream: true });
					buffer = consume(buffer, turn);
				}
			} catch {
				turn.error = "Stream capture failed";
			} finally {
				reader.releaseLock();
			}
		}
		const nativeFetch = window.fetch.bind(window);
		window.fetch = async (input, init) => {
			const startedAt = performance.now();
			const response = await nativeFetch(input, init);
			if (String(input).endsWith("/api/agent")) {
				const payload = JSON.parse(String(init?.body));
				const turn = {
					sessionId: payload.sessionId,
					query: payload.query,
					startedAt,
					frames: [] as { at: number; event: Record<string, unknown> }[],
					error: undefined as string | undefined,
				};
				telemetry.agent.push(turn);
				void captureStream(response, turn);
			}
			return response;
		};
		const acquire = navigator.mediaDevices.getUserMedia.bind(
			navigator.mediaDevices,
		);
		navigator.mediaDevices.getUserMedia = async (options) => {
			const stream = await acquire(options);
			telemetry.tracks.push(...stream.getTracks());
			return stream;
		};
		Object.defineProperty(window, "liveTelemetry", { value: telemetry });
	});
}
export async function resetTelemetry(page: Page) {
	await page.evaluate(() => {
		const t = window.liveTelemetry;
		t.events.length = 0;
		t.firstRecordedAudioAt = undefined;
		t.sent.length = 0;
		t.recordings.length = 0;
		t.agent.length = 0;
		t.recorders.length = 0;
	});
}
export async function captureAudio(page: Page) {
	return page.evaluate(async () => {
		const t = window.liveTelemetry;
		await Promise.all(
			t.recorders
				.filter((r) => r.state !== "inactive")
				.map(
					(r) =>
						new Promise<void>((resolve) => {
							r.addEventListener("stop", () => resolve(), { once: true });
							r.stop();
						}),
				),
		);
		const audio = new Blob(t.recordings, { type: "audio/webm" });
		const base64 = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onerror = () => reject(Error("Audio capture failed"));
			reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
			reader.readAsDataURL(audio);
		});
		return {
			events: t.events,
			agent: t.agent,
			firstRecordedAudioAt: t.firstRecordedAudioAt,
			sent: t.sent,
			bytes: audio.size,
			base64,
			recorderCount: t.recorders.length,
		};
	});
}
