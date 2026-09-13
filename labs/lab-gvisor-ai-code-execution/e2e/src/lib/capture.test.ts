import { expect, it } from "vitest";
import { validateRawOutput } from "./capture.js";

function capture(bytes: number) {
	return ["stdout", "stderr"]
		.flatMap((stream) =>
			Array.from({ length: bytes / 1024 }, () =>
				JSON.stringify({
					captureVersion: 1,
					stream,
					dataB64: Buffer.alloc(1024, 120).toString("base64"),
				}),
			),
		)
		.concat(
			JSON.stringify({
				captureComplete: true,
				captureTruncationReported: true,
			}),
		)
		.join("\n");
}
it("rejects raw oversized output even if a defensive view would clamp to 8192", () => {
	expect(() => validateRawOutput(capture(9216))).toThrow();
});
it("accepts complete bounded raw flood capture", () => {
	expect(() => validateRawOutput(capture(8192))).not.toThrow();
});
it("requires complete capture rather than treating retrieval clipping as runner enforcement", () => {
	expect(() =>
		validateRawOutput(capture(8192).split("\n").slice(0, -1).join("\n")),
	).toThrow();
});
