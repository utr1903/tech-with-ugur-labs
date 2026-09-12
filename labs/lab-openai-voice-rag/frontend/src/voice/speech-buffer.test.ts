import { expect, test } from "vitest";
import { createSpeechBuffer } from "./speech-buffer";

test("split citations never enter speech; trailing phrase waits for final", () => {
	const spoken: string[] = [];
	const b = createSpeechBuffer((s) => spoken.push(s));
	b.push("Code is ORCHID-47 [hand");
	b.push("book.md, chunk 1]. Next tail");
	expect(spoken).toEqual(["Code is ORCHID-47 ."]);
	b.finish();
	expect(spoken.at(-1)).toBe("Next tail");
});
test("even a long complete sentence yields bounded speech phrases", () => {
	const spoken: string[] = [];
	const b = createSpeechBuffer((s) => spoken.push(s));
	b.push(`${"word ".repeat(120)}end.`);
	b.finish();
	expect(spoken.length).toBeGreaterThan(2);
	expect(spoken.every((s) => s.length <= 220)).toBe(true);
});
