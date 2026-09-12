import { expect, test, vi } from "vitest";
import { createAudioLevel } from "./audio-level";

function fixture() {
	const frames: FrameRequestCallback[] = [];
	let amplitude = 0;
	const source = { connect: vi.fn(), disconnect: vi.fn() };
	const analyser = {
		fftSize: 32,
		disconnect: vi.fn(),
		getFloatTimeDomainData(data: Float32Array) {
			data.fill(amplitude);
		},
	};
	const context = {
		createMediaStreamSource: () => source,
		createAnalyser: () => analyser,
		resume: async () => {},
		close: vi.fn(async () => {}),
	};
	const levels: number[] = [];
	const observer = createAudioLevel((level) => levels.push(level), {
		context: () => context as unknown as AudioContext,
		frame: (cb) => {
			frames.push(cb);
			return frames.length;
		},
		cancel: vi.fn(),
	});
	return {
		observer,
		frames,
		levels,
		source,
		analyser,
		context,
		amplitude: (value: number) => {
			amplitude = value;
		},
	};
}
test("incoming RMS increases a bounded smoothed level without audible destination", () => {
	const f = fixture();
	f.observer.observe({} as MediaStream);
	f.frames.shift()?.(0);
	expect(f.levels.at(-1)).toBe(0);
	f.amplitude(0.2);
	f.frames.shift()?.(16);
	expect(f.levels.at(-1)).toBeGreaterThan(0.1);
	expect(f.levels.at(-1)).toBeLessThanOrEqual(1);
	expect(f.source.connect).toHaveBeenCalledExactlyOnceWith(f.analyser);
});
test("dispose closes owned resources resets level and rejects queued frames", () => {
	const f = fixture();
	f.observer.observe({} as MediaStream);
	const late = f.frames.shift();
	f.observer.dispose();
	const length = f.levels.length;
	late?.(20);
	expect(f.levels).toHaveLength(length);
	expect(f.levels.at(-1)).toBe(0);
	expect(f.source.disconnect).toHaveBeenCalledOnce();
	expect(f.analyser.disconnect).toHaveBeenCalledOnce();
	expect(f.context.close).toHaveBeenCalledOnce();
});
test("replacement rejects previous stream samples", () => {
	const f = fixture();
	f.observer.observe({} as MediaStream);
	const late = f.frames.shift();
	f.observer.observe({} as MediaStream);
	const length = f.levels.length;
	f.amplitude(1);
	late?.(16);
	expect(f.levels).toHaveLength(length);
});
test("unavailable audio context gracefully produces zero", () => {
	const levels: number[] = [];
	const observer = createAudioLevel((value) => levels.push(value), {
		context: () => {
			throw Error("Unavailable");
		},
		frame: vi.fn(),
		cancel: vi.fn(),
	});
	expect(() => observer.observe({} as MediaStream)).not.toThrow();
	expect(levels.at(-1)).toBe(0);
});
