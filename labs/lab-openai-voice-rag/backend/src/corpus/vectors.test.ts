import { expect, test } from "vitest";
import { validateVectors } from "./vectors.js";

test("rejects count, dimension, nonfinite and zero vectors", () => {
	for (const vectors of [
		[],
		[[1]],
		[Array(1536).fill(Number.NaN)],
		[Array(1536).fill(0)],
	])
		expect(() => validateVectors(vectors, 1)).toThrow();
	expect(() => validateVectors([Array(1536).fill(1)], 1)).not.toThrow();
});
