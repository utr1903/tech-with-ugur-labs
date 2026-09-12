export function chunkText(text: string, length = 800): string[] {
	if (!Number.isSafeInteger(length) || length < 1)
		throw new Error("Invalid chunk length");
	const chunks: string[] = [];
	for (let start = 0; start < text.length; start += length) {
		const chunk = text.slice(start, start + length);
		if (chunk.trim()) chunks.push(chunk);
	}
	return chunks;
}
