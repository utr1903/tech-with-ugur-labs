import { abortable } from "../lib/abort.js";
export const boundedFetch: typeof fetch = async (input, init) => {
	const response = await fetch(input, init);
	const reader = response.body?.getReader();
	if (!reader) return response;
	const chunks: Uint8Array[] = [];
	let length = 0;
	const signal = init?.signal ?? AbortSignal.timeout(120000);
	try {
		for (;;) {
			const { done, value } = await abortable(reader.read(), signal);
			if (done) break;
			length += value.byteLength;
			if (length > 65536) throw new Error("Provider response too large.");
			chunks.push(value);
		}
		return new Response(Buffer.concat(chunks), {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	} finally {
		void reader.cancel().catch(() => {});
	}
};
