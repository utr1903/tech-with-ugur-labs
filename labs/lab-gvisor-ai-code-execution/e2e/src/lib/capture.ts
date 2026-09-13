import assert from "node:assert/strict";
export function validateRawOutput(logs: string) {
	const frames = logs
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	const summary = frames.findLast((frame) => frame.captureComplete === true);
	assert(
		summary,
		"Complete capture required to distinguish runner bounds from retrieval clipping.",
	);
	assert.equal(
		summary.captureTruncationReported,
		true,
		"Runner advisory truncation expected for known flood.",
	);
	const rawBytes: Record<string, number> = {};
	for (const stream of ["stdout", "stderr"]) {
		rawBytes[stream] = frames
			.filter((frame) => frame.captureVersion === 1 && frame.stream === stream)
			.reduce(
				(total, frame) => total + Buffer.from(frame.dataB64, "base64").length,
				0,
			);
		assert.equal(
			rawBytes[stream],
			8192,
			"Raw capture exceeds or fails to reach expected flood bound.",
		);
	}
	return { rawBytes, captureComplete: true, runnerReportedTruncation: true };
}
