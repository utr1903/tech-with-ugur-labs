import type { Call, Transport } from "./transport";
export function createScripted(acquire: () => Promise<MediaStream>): Transport {
	let disposed = false;
	let stream: MediaStream | undefined;
	let emit: ((call: Call) => void) | undefined;
	return {
		async start(_token, call) {
			const acquired = await acquire();
			if (disposed) {
				for (const track of acquired.getTracks()) track.stop();
				return;
			}
			stream = acquired;
			emit = call;
		},
		question(question) {
			if (!disposed) emit?.({ id: crypto.randomUUID(), question });
		},
		say() {},
		clearSpeech() {},
		dispose() {
			if (disposed) return;
			disposed = true;
			emit = undefined;
			for (const track of stream?.getTracks() ?? []) track.stop();
			stream = undefined;
		},
	};
}
