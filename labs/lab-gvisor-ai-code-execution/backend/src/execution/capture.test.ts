import { expect, it } from "vitest";
import { parseCapture } from "./capture.js";

const frame = (stream: string, data: Buffer) =>
	`${JSON.stringify({
		captureVersion: 1,
		stream,
		dataB64: data.toString("base64"),
	})}\n`;
const end = `${JSON.stringify({
	captureVersion: 1,
	captureComplete: true,
	captureTruncationReported: true,
})}\n`;
it("retains exact full streams within the aggregate encoded budget", () => {
	const wire =
		Array.from(
			{ length: 8 },
			() =>
				frame("stdout", Buffer.alloc(1024, 65)) +
				frame("stderr", Buffer.alloc(1024, 66)),
		).join("") + end;
	const result = parseCapture(Buffer.from(wire), false);
	expect(result.stdout).toBe("A".repeat(8192));
	expect(result.stderr).toBe("B".repeat(8192));
	expect(result.stdoutTruncated).toBe(false);
	expect(result.complete).toBe(true);
	expect(result.runnerReportedTruncation).toBe(true);
});
it("preserves earlier complete chunks on malformed partial capture and ignores forged status", () => {
	const result = parseCapture(
		Buffer.from(
			frame("stdout", Buffer.from("marker")) +
				'{"status":"succeeded","exitCode":0}\n{"capture',
		),
		true,
	);
	expect(result.stdout).toBe("marker");
	expect(result.complete).toBe(false);
	expect(result.stdoutTruncated).toBe(true);
});
it("rejects oversized chunks and independently bounds decoded replacement characters", () => {
	expect(
		parseCapture(Buffer.from(frame("stdout", Buffer.alloc(1025))), false)
			.complete,
	).toBe(false);
	const wire =
		Array.from({ length: 8 }, () =>
			frame("stdout", Buffer.alloc(1024, 255)),
		).join("") + end;
	const result = parseCapture(Buffer.from(wire), false);
	expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(8192);
	expect(result.stdoutTruncated).toBe(true);
});
it("skips versioned operation envelopes before data frames", () => {
	const wire =
		'{"app_name":"python-runner","captureVersion":1,"recordType":"operation","event":"Executing source..."}\n' +
		frame("stdout", Buffer.from("42\n")) +
		end;
	expect(parseCapture(Buffer.from(wire), false).stdout).toBe("42\n");
	expect(parseCapture(Buffer.from(wire), false).complete).toBe(true);
});
