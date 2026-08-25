import type { InstantSample } from "./client.js";

// True when |a-b| is within max(absTol, relTol * max(|a|,|b|)).
export function approxEqual(
  a: number,
  b: number,
  { relTol, absTol }: { relTol: number; absTol: number },
): boolean {
  const allowed = Math.max(absTol, relTol * Math.max(Math.abs(a), Math.abs(b)));
  return Math.abs(a - b) <= allowed;
}

export function singleValue(samples: InstantSample[]): number {
  if (samples.length !== 1) {
    throw new Error(`expected exactly 1 series, got ${samples.length}`);
  }
  const sample = samples[0] as InstantSample;
  return Number.parseFloat(sample.value[1]);
}
