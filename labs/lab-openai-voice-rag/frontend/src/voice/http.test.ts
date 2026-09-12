import { expect, test, vi } from "vitest";
import { fetchAnswer } from "./http";

test("NDJSON delivers fragmented UTF8 deltas before held done", async () => {
	let stream!: ReadableStreamDefaultController<Uint8Array>;
	const events: unknown[] = [];
	vi.stubGlobal(
		"fetch",
		async () =>
			new Response(
				new ReadableStream({
					start: (c) => {
						stream = c;
					},
				}),
				{ headers: { "Content-Type": "application/x-ndjson" } },
			),
	);
	const promise = fetchAnswer("uuid", "q", new AbortController().signal, (e) =>
		events.push(e),
	);
	await Promise.resolve();
	await Promise.resolve();
	const bytes = new TextEncoder().encode('{"type":"delta","text":"Café."}\n');
	const split = bytes.indexOf(195) + 1;
	stream.enqueue(bytes.slice(0, split));
	stream.enqueue(bytes.slice(split));
	await vi.waitFor(() =>
		expect(events).toEqual([{ type: "delta", text: "Café." }]),
	);
	stream.enqueue(
		new TextEncoder().encode('{"type":"done","answer":"Café.","sources":[]}\n'),
	);
	stream.close();
	expect(await promise).toEqual({ answer: "Café.", sources: [] });
	vi.unstubAllGlobals();
});
test("EOF without done and malformed sources fail", async () => {
	for (const text of [
		'{"type":"delta","text":"partial"}\n',
		'{"type":"sources","sources":[{}]}\n',
	]) {
		vi.stubGlobal(
			"fetch",
			async () =>
				new Response(text, {
					headers: { "Content-Type": "application/x-ndjson" },
				}),
		);
		await expect(
			fetchAnswer("id", "q", new AbortController().signal, () => {}),
		).rejects.toThrow();
	}
	vi.unstubAllGlobals();
});

test("strict final framing, invalid events, oversized output and safe stream errors fail", async () => {
	const cases = [
		'{"type":"done","answer":"different","sources":[]}\n',
		'{"type":"done","answer":"","sources":[]}',
		'{"type":"done","answer":"","sources":[]}\n{"type":"delta","text":"late"}\n',
		'{"type":"status","stage":"unknown"}\n',
		'{"type":"delta","text":3}\n',
		'{"type":"error","message":"private detail"}\n',
		`${JSON.stringify({ type: "delta", text: "a".repeat(40001) })}\n`,
		"a".repeat(200001),
	];
	for (const text of cases) {
		vi.stubGlobal(
			"fetch",
			async () =>
				new Response(text, {
					headers: { "Content-Type": "application/x-ndjson" },
				}),
		);
		await expect(
			fetchAnswer("id", "q", new AbortController().signal, () => {}),
		).rejects.toThrow();
	}
	vi.unstubAllGlobals();
});
