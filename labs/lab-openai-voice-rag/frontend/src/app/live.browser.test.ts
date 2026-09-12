import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	captureAudio,
	installTelemetry,
	resetTelemetry,
} from "./live-telemetry.browser";
import { completionUsage } from "./live-usage";

test.skip(
	process.env.RUN_LIVE_CANARY !== "1",
	"Paid live canary is explicitly opt-in.",
);
test("live transcripts, streaming answers, playback and persistent chat identity", async ({
	page,
	request,
}, info) => {
	test.setTimeout(240000);
	const file = process.env.LIVE_AUDIO_FILE;
	if (!file) throw Error("Supply LIVE_AUDIO_FILE WAV");
	const header = readFileSync(file);
	expect(header.subarray(0, 4).toString()).toBe("RIFF");
	expect(header.subarray(8, 12).toString()).toBe("WAVE");
	expect((await (await request.get("/api/ready")).json()).mode).toBe("live");
	expect((await request.post("/api/ingest")).ok()).toBe(true);
	await installTelemetry(page);
	await page.goto("/");
	const ids: string[] = [];
	const sessions: unknown[] = [];
	for (let session = 0; session < 2; session++) {
		await resetTelemetry(page);
		await page.getByRole("button", { name: "Start", exact: true }).click();
		// The fake microphone loops the supplied WAV; observe two actual completed turns.
		await expect
			.poll(
				() =>
					page.evaluate(
						() =>
							window.liveTelemetry.agent.filter((t) =>
								t.frames.some((f) => f.event.type === "done"),
							).length,
					),
				{ timeout: 90000 },
			)
			.toBeGreaterThanOrEqual(2);
		await expect
			.poll(
				() =>
					page.evaluate(
						() =>
							window.liveTelemetry.events.filter(
								(e) => e.type === "output_audio_buffer.stopped",
							).length,
					),
				{ timeout: 45000 },
			)
			.toBeGreaterThan(0);
		const telemetry = await captureAudio(page);
		const turns = telemetry.agent.filter((t) =>
			t.frames.some((f) => f.event.type === "done"),
		);
		expect(turns.length).toBeGreaterThanOrEqual(2);
		expect(turns[0]?.sessionId).toBe(turns[1]?.sessionId);
		ids.push(String(turns[0]?.sessionId));
		for (const turn of turns) {
			expect(telemetry.events).toContainEqual(
				expect.objectContaining({
					type: "conversation.item.input_audio_transcription.completed",
					transcript: turn.query,
				}),
			);
			expect(turn.frames.some((f) => f.event.type === "delta")).toBe(true);
			expect(
				turn.frames.find((f) => f.event.type === "done")?.event.answer,
			).toContain("ORCHID-47");
		}
		expect(telemetry.events).toContainEqual(
			expect.objectContaining({
				type: "response.output_audio_transcript.done",
				transcript: expect.stringMatching(
					/orchid(?:[ -]+)?(?:47|forty[ -]+seven)/i,
				),
			}),
		);
		expect(telemetry.bytes).toBeGreaterThan(1000);
		await info.attach(`session-${session + 1}-remote-audio.webm`, {
			body: Buffer.from(telemetry.base64, "base64"),
			contentType: "audio/webm",
		});
		sessions.push({
			...telemetry,
			base64: undefined,
			agent: telemetry.agent.map((turn) => ({
				...turn,
				firstTextAt: turn.frames.find((f) => f.event.type === "delta")?.at,
				doneAt: turn.frames.find((f) => f.event.type === "done")?.at,
			})),
			realtimeUsage: completionUsage(telemetry.events),
			ownerPlaybackConfirmation: "PENDING",
		});
		await page.getByRole("button", { name: "Stop", exact: true }).click();
		await expect
			.poll(() =>
				page.evaluate(() =>
					window.liveTelemetry.tracks.every((t) => t.readyState === "ended"),
				),
			)
			.toBe(true);
	}
	expect(ids[0]).not.toBe(ids[1]);
	await info.attach("live-canary.json", {
		body: JSON.stringify(
			{ sessions, ownerPlaybackConfirmation: "PENDING" },
			null,
			2,
		),
		contentType: "application/json",
	});
});
