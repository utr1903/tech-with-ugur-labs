import { expect, test } from "@playwright/test";

type Harness = {
	sent: Record<string, unknown>[];
	requests: { sessionId: string; query: string }[];
	emit(event: unknown): void;
	release(): void;
	aborted: boolean;
};
declare global {
	interface Window {
		streamHarness: Harness;
	}
}
test("completed transcript streams UI and queued speech before held done; barge-in aborts", async ({
	page,
}) => {
	await page.addInitScript(() => {
		const h: Harness = {
			sent: [],
			requests: [],
			emit() {},
			release() {},
			aborted: false,
		};
		window.streamHarness = h;
		class Peer {
			addTrack() {}
			close() {}
			async createOffer() {
				return { sdp: "test-offer" };
			}
			async setLocalDescription() {}
			async setRemoteDescription() {}
			createDataChannel() {
				const channel = Object.assign(new EventTarget(), {
					readyState: "open",
					send(data: string) {
						h.sent.push(JSON.parse(data));
					},
					close() {},
					onmessage: null as ((e: { data: string }) => void) | null,
				});
				h.emit = (e) => channel.onmessage?.({ data: JSON.stringify(e) });
				return channel;
			}
		}
		Object.defineProperty(window, "RTCPeerConnection", { value: Peer });
		const nativeFetch = window.fetch.bind(window);
		window.fetch = async (input, init) => {
			if (!String(input).endsWith("/api/agent"))
				return nativeFetch(input, init);
			h.requests.push(JSON.parse(String(init?.body)));
			const encoder = new TextEncoder();
			const body = new ReadableStream<Uint8Array>({
				start(c) {
					const emit = (e: unknown) =>
						c.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
					emit({
						type: "sources",
						sources: [
							{
								id: "s",
								filename: "handbook.md",
								ordinal: 1,
								text: "Evidence",
							},
						],
					});
					emit({ type: "delta", text: "First [1]. Second." });
					h.release = () => {
						emit({
							type: "done",
							answer: "First [1]. Second.",
							sources: [
								{
									id: "s",
									filename: "handbook.md",
									ordinal: 1,
									text: "Evidence",
								},
							],
						});
						c.close();
					};
					init?.signal?.addEventListener(
						"abort",
						() => {
							h.aborted = true;
							c.error(new DOMException("Aborted", "AbortError"));
						},
						{ once: true },
					);
				},
			});
			return new Response(body, {
				headers: { "Content-Type": "application/x-ndjson" },
			});
		};
	});
	await page.route("**/api/realtime/token", (r) =>
		r.fulfill({
			json: { mode: "live", clientSecret: "TEST_EPHEMERAL_PLACEHOLDER" },
		}),
	);
	await page.route("https://api.openai.com/v1/realtime/calls", (r) =>
		r.fulfill({ body: "test-answer" }),
	);
	await page.goto("/");
	await page.getByRole("button", { name: "Start", exact: true }).click();
	await expect(page.getByRole("status")).toHaveText("Ready");
	await page.evaluate(() => {
		const h = window.streamHarness;
		h.emit({ type: "input_audio_buffer.committed", item_id: "a" });
		h.emit({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "a",
			transcript: "What is the amber valve recovery code?",
		});
	});
	await expect(
		page.getByRole("region", { name: "Recognized question" }),
	).toContainText("What is the amber valve recovery code?");
	await expect(page.getByRole("region", { name: "Answer" })).toContainText(
		"First [1]. Second.",
	);
	await expect(page.getByRole("region", { name: "Answer" })).toContainText(
		"handbook.md",
	);
	await expect(page.getByRole("status")).toHaveText("Answering");
	const first = await page.evaluate(() =>
		window.streamHarness.sent.filter((e) => e.type === "response.create"),
	);
	expect(first).toHaveLength(1);
	expect(first[0]).toMatchObject({
		response: {
			conversation: "none",
			tools: [],
			tool_choice: "none",
			input: [{ content: [{ text: "First ." }] }],
		},
	});
	await page.evaluate(() => {
		const h = window.streamHarness;
		const phrase = h.sent.find((e) => e.type === "response.create")
			?.response as { metadata: unknown };
		h.emit({
			type: "response.created",
			response: { id: "r1", metadata: phrase.metadata },
		});
		h.emit({
			type: "response.done",
			response: { id: "r1", status: "completed" },
		});
	});
	expect(
		await page.evaluate(
			() =>
				window.streamHarness.sent.filter((e) => e.type === "response.create")
					.length,
		),
	).toBe(1);
	await page.evaluate(() =>
		window.streamHarness.emit({
			type: "output_audio_buffer.stopped",
			response_id: "r1",
		}),
	);
	expect(
		await page.evaluate(
			() =>
				window.streamHarness.sent.filter((e) => e.type === "response.create")
					.length,
		),
	).toBe(2);
	await page.evaluate(() =>
		window.streamHarness.emit({ type: "input_audio_buffer.speech_started" }),
	);
	await expect
		.poll(() => page.evaluate(() => window.streamHarness.aborted))
		.toBe(true);
	await expect(page.getByRole("status")).toHaveText("Ready");
	await page.getByRole("button", { name: "Stop", exact: true }).click();
});
