type Platform = {
	context(): AudioContext;
	frame(callback: FrameRequestCallback): number;
	cancel(id: number): void;
};
const browser: Platform = {
	context: () => new AudioContext(),
	frame: (callback) => requestAnimationFrame(callback),
	cancel: (id) => cancelAnimationFrame(id),
};
/** Owns only the silent analysis graph; the audio element owns playback. */
export function createAudioLevel(
	change: (level: number) => void,
	platform: Platform = browser,
) {
	let context: AudioContext | undefined;
	let source: MediaStreamAudioSourceNode | undefined;
	let analyser: AnalyserNode | undefined;
	let frame: number | undefined;
	let generation = 0;
	let disposed = false;
	function clear() {
		generation++;
		if (frame !== undefined) platform.cancel(frame);
		frame = undefined;
		source?.disconnect();
		analyser?.disconnect();
		source = undefined;
		analyser = undefined;
		change(0);
	}
	function prepare() {
		if (disposed || context) return;
		try {
			context = platform.context();
			void context.resume().catch(() => {});
		} catch {
			change(0);
		}
	}
	function dispose() {
		if (disposed) return;
		disposed = true;
		clear();
		const owned = context;
		context = undefined;
		if (owned) void owned.close().catch(() => {});
	}
	function observe(stream: MediaStream) {
		if (disposed) return;
		clear();
		prepare();
		if (!context) return;
		try {
			source = context.createMediaStreamSource(stream);
			analyser = context.createAnalyser();
			analyser.fftSize = 256;
			source.connect(analyser);
			const node = analyser;
			const data = new Float32Array(node.fftSize);
			const current = generation;
			let level = 0;
			const sample: FrameRequestCallback = () => {
				if (disposed || current !== generation) return;
				try {
					node.getFloatTimeDomainData(data);
					let squares = 0;
					for (const value of data) squares += value * value;
					const target = Math.min(1, Math.sqrt(squares / data.length) * 5);
					level += (target - level) * (target > level ? 0.35 : 0.12);
					change(level);
					frame = platform.frame(sample);
				} catch {
					dispose();
				}
			};
			frame = platform.frame(sample);
		} catch {
			dispose();
		}
	}
	return { prepare, observe, dispose };
}
