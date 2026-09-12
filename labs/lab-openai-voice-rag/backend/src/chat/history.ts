import type { Message } from "../provider/types.js";
export function boundedHistory(
	turns: { query: string; answer: string | null }[],
): Message[] {
	const selected: Message[][] = [];
	let chars = 0;
	for (const turn of turns) {
		if (turn.answer === null) continue;
		const size = turn.query.length + turn.answer.length;
		if (selected.length === 20 || chars + size > 40000) break;
		selected.push([
			{ role: "user", content: turn.query },
			{ role: "assistant", content: turn.answer },
		]);
		chars += size;
	}
	return selected.reverse().flat();
}
