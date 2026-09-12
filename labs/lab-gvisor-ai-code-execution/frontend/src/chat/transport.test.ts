import { describe, expect, it, vi } from "vitest";
import {
	applyEvent,
	createEventDecoder,
	reconcileMessages,
	streamTurn,
} from "./transport";

describe("chat transport", () => {
	it("parses split frames and CRLF", () => {
		const d = createEventDecoder();
		expect(d.push('event: chat\r\ndata: {"type":"do')).toEqual([]);
		expect(d.push('ne","sequence":1}\r\n\r\n')).toEqual([
			{ type: "done", sequence: 1 },
		]);
	});
	it("rejects malformed data", () => {
		expect(() => createEventDecoder().push("data: invalid\n\n")).toThrow();
	});
	it("reconciles canonical tool IDs with streamed results", () => {
		const result = {
			executionId: "job1",
			status: "succeeded",
			stdout: "<b>hello</b>",
			stderr: "",
			stdoutTruncated: false,
			stderrTruncated: false,
			runnerReportedTruncation: false,
			exitCode: 0,
		};
		let messages = applyEvent([], {
			type: "tool-start",
			id: "call1",
			executionId: "job1",
			sequence: 1,
		});
		messages = applyEvent(messages, {
			type: "tool-result",
			id: "call1",
			result,
			sequence: 2,
		});
		expect(
			reconcileMessages(messages, [
				{ id: "tool:call1", role: "tool", text: JSON.stringify(result) },
			]),
		).toHaveLength(1);
	});
	it("restores canonical user and assistant history without duplicates", () => {
		expect(
			reconcileMessages(
				[{ id: "a", role: "assistant", text: "old" }],
				[
					{ id: "u", role: "user", text: "hello" },
					{ id: "a", role: "assistant", text: "final" },
				],
			),
		).toEqual([
			{ id: "u", role: "user", text: "hello" },
			{ id: "a", role: "assistant", text: "final" },
		]);
	});
	it("does not add terminal errors as transcript content", () => {
		expect(
			applyEvent([], { type: "error", message: "failed", sequence: 4 }),
		).toEqual([]);
	});
});
it("streams split UTF-8 frames and preserves terminal server errors", async () => {
	const encoder = new TextEncoder();
	const events = [
		{ type: "tool-start", id: "call", executionId: "job", sequence: 1 },
		{ type: "assistant", id: "reply", text: "héllo", sequence: 2 },
		{ type: "error", message: "deadline", sequence: 3 },
	];
	const bytes = encoder.encode(
		events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
	);
	vi.stubGlobal(
		"fetch",
		async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						for (const byte of bytes)
							controller.enqueue(new Uint8Array([byte]));
						controller.close();
					},
				}),
			),
	);
	const received: unknown[] = [];
	await streamTurn(
		"http://localhost",
		"thread",
		{ turnId: "turn", messages: [] },
		7,
		new AbortController().signal,
		(event) => received.push(event),
	);
	expect(received).toEqual(events);
	vi.unstubAllGlobals();
});
it("rejects interrupted nonterminal streams", async () => {
	vi.stubGlobal(
		"fetch",
		async () =>
			new Response(
				'data: {"type":"assistant","id":"a","text":"partial","sequence":1}\n\n',
			),
	);
	await expect(
		streamTurn(
			"http://localhost",
			"t",
			{ turnId: "turn", messages: [] },
			0,
			new AbortController().signal,
			() => {},
		),
	).rejects.toThrow("interrupted");
	vi.unstubAllGlobals();
});
