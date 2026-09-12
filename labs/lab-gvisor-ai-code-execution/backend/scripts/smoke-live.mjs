import assert from "node:assert/strict";

const base = process.env.BACKEND_URL ?? "http://127.0.0.1:3001";
const url = new URL(base);
assert(
	["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
	"Localhost backend required.",
);
const created = await fetch(`${base}/threads`, {
	method: "POST",
	signal: AbortSignal.timeout(5000),
});
assert(created.ok, "Thread creation failed.");
const thread = await created.json();
const response = await fetch(`${base}/threads/${thread.id}/chat`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({
		turnId: crypto.randomUUID(),
		messages: [
			{
				id: crypto.randomUUID(),
				role: "user",
				text: "Use code_executor to calculate 6 times 7 with Python and print the result.",
			},
		],
	}),
	signal: AbortSignal.timeout(310000),
});
assert(response.ok, "Chat request failed.");
const text = await response.text();
assert(Buffer.byteLength(text) <= 262144, "Event limit exceeded.");
const events = text
	.split("\n")
	.filter((line) => line.startsWith("data: "))
	.map((line) => JSON.parse(line.slice(6)));
assert(
	events.some(
		(event) =>
			event.type === "tool-result" &&
			event.result.status === "succeeded" &&
			event.result.stdout.trim() === "42",
	),
	"Expected successful Python tool result.",
);
assert(events.at(-1)?.type === "done", "Turn did not finish.");
process.stdout.write(
	`${JSON.stringify({ status: "passed", threadId: thread.id, events: events.length })}\n`,
);
