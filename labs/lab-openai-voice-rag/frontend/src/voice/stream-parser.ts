import type { AgentEvent, Answer, Source } from "./transport";

function sources(input: unknown): Source[] {
	if (!Array.isArray(input) || input.length > 20)
		throw Error("Invalid sources");
	for (const s of input)
		if (
			!s ||
			typeof s.id !== "string" ||
			typeof s.filename !== "string" ||
			!Number.isInteger(s.ordinal) ||
			s.ordinal < 0 ||
			typeof s.text !== "string" ||
			s.text.length > 40000
		)
			throw Error("Invalid source");
	return input;
}
function parse(line: string): AgentEvent {
	const e = JSON.parse(line);
	if (!e || typeof e !== "object") throw Error("Invalid event");
	switch (e.type) {
		case "status":
			if (e.stage === "searching" || e.stage === "answering") return e;
			break;
		case "sources":
			return { type: "sources", sources: sources(e.sources) };
		case "delta":
			if (typeof e.text === "string") return e;
			break;
		case "done":
			if (typeof e.answer === "string")
				return { type: "done", answer: e.answer, sources: sources(e.sources) };
			break;
		case "error":
			if (typeof e.message === "string") return e;
			break;
	}
	throw Error("Invalid event");
}
export async function readAnswer(
	body: ReadableStream<Uint8Array>,
	onEvent: (event: AgentEvent) => void,
): Promise<Answer> {
	const reader = body.getReader(),
		decoder = new TextDecoder("utf-8", { fatal: true });
	let buffer = "",
		text = "";
	let done: Answer | undefined;
	function accept(line: string) {
		if (line.length > 200000 || done) throw Error("Invalid stream");
		const e = parse(line);
		if (e.type === "error") throw Error("Knowledge request failed");
		if (e.type === "delta") {
			text += e.text;
			if (text.length > 40000) throw Error("Answer too large");
		}
		if (e.type === "done") {
			if (e.answer !== text) throw Error("Answer mismatch");
			done = { answer: e.answer, sources: e.sources };
		}
		onEvent(e);
	}
	function consume() {
		let newline = buffer.indexOf("\n");
		while (newline >= 0) {
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			accept(line);
			newline = buffer.indexOf("\n");
		}
		if (buffer.length > 200000) throw Error("Frame too large");
	}
	try {
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			buffer += decoder.decode(part.value, { stream: true });
			consume();
		}
		buffer += decoder.decode();
		consume();
		if (buffer || !done) throw Error("Incomplete answer stream");
		return done;
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
