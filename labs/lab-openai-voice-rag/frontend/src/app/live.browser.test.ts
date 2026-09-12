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
test("actual live voice canary, correlated evidence, audio transcript and fresh session", async ({
	page,
	request,
}, info) => {
	test.setTimeout(180_000);
	const file = process.env.LIVE_AUDIO_FILE;
	if (!file)
		throw Error("LIVE_AUDIO_FILE must point to a supplied WAV recording.");
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
		const started = Date.now();
		const tokenResponse = page.waitForResponse(
			(r) => r.url().endsWith("/api/realtime/token") && r.ok(),
		);
		const answerResponse = page.waitForResponse(
			(r) => r.url().endsWith("/api/agent") && r.ok(),
			{ timeout: 60_000 },
		);
		void answerResponse.catch(() => {});
		await page.getByRole("button", { name: "Start", exact: true }).click();
		const token = await (await tokenResponse).json();
		expect(token.mode).toBe("live");
		ids.push(token.conversationId);
		await expect(page.getByRole("status")).toHaveText("Ready", {
			timeout: 25_000,
		});
		await expect(page.getByRole("region", { name: "Answer" })).toContainText(
			"ORCHID-47",
			{ timeout: 60_000 },
		);
		await expect(page.getByRole("region", { name: "Answer" })).toContainText(
			"handbook.md",
		);
		const response = await answerResponse;
		const backendAnswer = await response.json();
		expect(backendAnswer.answer).toContain("ORCHID-47");
		expect(backendAnswer.sources).toContainEqual(
			expect.objectContaining({ filename: "handbook.md" }),
		);
		expect(response.request().postDataJSON()).toMatchObject({
			conversationId: token.conversationId,
			question: expect.stringMatching(/amber/i),
		});
		await expect
			.poll(
				() =>
					page.evaluate(
						() =>
							window.liveTelemetry.events.filter(
								(e) =>
									e.type === "response.output_audio_transcript.done" &&
									typeof e.transcript === "string" &&
									/orchid(?:[ -]+)?(?:47|forty[ -]+seven)/i.test(e.transcript),
							).length,
					),
				{ timeout: 45_000 },
			)
			.toBeGreaterThan(0);
		const telemetry = await captureAudio(page);
		const calls = telemetry.events.filter(
			(e) =>
				e.type === "response.function_call_arguments.done" &&
				e.name === "ask_knowledge_base",
		);
		const call = calls.find((c) =>
			telemetry.sent.some((e) => {
				const item = e.item as Record<string, unknown> | undefined;
				if (!item) return false;
				return (
					item.call_id === c.call_id &&
					typeof item.output === "string" &&
					item.output.includes("ORCHID-47")
				);
			}),
		);
		expect(call).toBeDefined();
		expect(String(call?.arguments)).toMatch(/amber/i);
		expect(telemetry.sent).toContainEqual(
			expect.objectContaining({
				type: "conversation.item.create",
				item: expect.objectContaining({
					type: "function_call_output",
					call_id: call?.call_id,
					output: expect.stringContaining("ORCHID-47"),
				}),
			}),
		);
		expect(telemetry.recorderCount).toBeGreaterThan(0);
		expect(telemetry.bytes).toBeGreaterThan(1000);
		await info.attach(`session-${session + 1}-remote-audio.webm`, {
			body: Buffer.from(telemetry.base64, "base64"),
			contentType: "audio/webm",
		});
		sessions.push({
			conversationId: token.conversationId,
			latencyMs: Date.now() - started,
			backendAnswer,
			events: telemetry.events.filter(
				(e) =>
					e.type === "response.function_call_arguments.done" ||
					e.type === "response.output_audio_transcript.done",
			),
			realtimeUsage: completionUsage(telemetry.events),
			remoteAudioBytes: telemetry.bytes,
			ownerPlaybackConfirmation:
				"PENDING — automated capture does not establish intelligibility",
		});
		await page.getByRole("button", { name: "Stop", exact: true }).click();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						window.liveTelemetry.tracks.length > 0 &&
						window.liveTelemetry.tracks.every((t) => t.readyState === "ended"),
				),
			)
			.toBe(true);
		await expect(page.getByRole("region", { name: "Answer" })).toHaveCount(0);
	}
	expect(ids).toHaveLength(2);
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
