import { createHash } from "node:crypto";

function addWord(vector: number[], word: string) {
	const hash = createHash("sha256").update(word).digest();
	for (let feature = 0; feature < 4; feature++) {
		const index = hash.readUInt32BE(feature * 4) % 1536;
		const sign = hash.readUInt8(16 + feature) % 2 === 0 ? 1 : -1;
		vector[index] = (vector[index] ?? 0) + sign;
	}
}
function embedText(text: string) {
	const vector = Array<number>(1536).fill(0);
	for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
		addWord(vector, word);
	const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
	if (norm === 0) {
		vector[0] = 1;
		return vector;
	}
	return vector.map((value) => value / norm);
}
/** Simulated embeddings for keyless verification; not model inference. */
export async function scriptedEmbed(texts: string[]): Promise<number[][]> {
	return texts.map(embedText);
}
