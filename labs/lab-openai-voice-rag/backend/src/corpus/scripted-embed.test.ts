import { expect, test } from "vitest";
import { scriptedEmbed } from "./scripted-embed.js";

test("produces deterministic normalized 1536-dimensional simulated word features", async () => {
	const vectors = await scriptedEmbed([
		"amber valve",
		"amber valve",
		"violet engine",
	]);
	expect(vectors).toHaveLength(3);
	expect(vectors[0]).toHaveLength(1536);
	expect(vectors[0]).toEqual(vectors[1]);
	expect(vectors[0]).not.toEqual(vectors[2]);
	expect(vectors[0]?.reduce((sum, v) => sum + v * v, 0)).toBeCloseTo(1);
});
