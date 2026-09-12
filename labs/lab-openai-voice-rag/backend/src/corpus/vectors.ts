export function validateVectors(vectors: number[][], count: number): void {
	if (vectors.length !== count) throw new Error("Embedding count mismatch");
	for (const vector of vectors) {
		if (
			vector.length !== 1536 ||
			!vector.every(Number.isFinite) ||
			!vector.some((value) => value !== 0)
		)
			throw new Error(
				"Embedding must contain 1536 finite dimensions and nonzero magnitude",
			);
	}
}
