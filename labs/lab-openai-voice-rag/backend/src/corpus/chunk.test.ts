import { expect, test } from "vitest";
import { chunkText } from "./chunk.js";

test("produces nonempty ordered bounded chunks without dropping text", () => {
	expect(chunkText("abcde fghij klmno", 6)).toEqual([
		"abcde ",
		"fghij ",
		"klmno",
	]);
	expect(chunkText("   ")).toEqual([]);
});
test("rejects invalid chunk limits", () => {
	expect(() => chunkText("hello", 0)).toThrow();
});
