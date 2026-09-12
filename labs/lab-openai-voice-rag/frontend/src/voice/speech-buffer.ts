function phraseLength(buffer: string, final: boolean) {
	const match = /[.!?](?=\s|$)|[;:](?=\s)/.exec(buffer);
	if (match && match.index < 220) return match.index + 1;
	if (buffer.length >= 220) {
		const space = buffer.lastIndexOf(" ", 220);
		return space < 80 ? 220 : space;
	}
	return final ? buffer.length : 0;
}
export function createSpeechBuffer(say: (text: string) => void) {
	let buffer = "",
		citation = false;
	function deliver(final = false) {
		while (buffer) {
			const length = phraseLength(buffer, final);
			if (!length) return;
			const text = buffer.slice(0, length).trim();
			buffer = buffer.slice(length).trimStart();
			if (text) say(text);
		}
	}
	return {
		push(text: string) {
			for (const c of text) {
				if (c === "[") {
					citation = true;
					continue;
				}
				if (citation) {
					if (c === "]") citation = false;
					continue;
				}
				buffer += c;
			}
			deliver();
		},
		finish() {
			deliver(true);
		},
	};
}
