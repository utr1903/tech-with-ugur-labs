type Capture = {
	stdout: string;
	stderr: string;
	stdoutTruncated: boolean;
	stderrTruncated: boolean;
	runnerReportedTruncation: boolean;
	complete: boolean;
};
type Stream = { data: Buffer; truncated: boolean };
function append(stream: Stream, data: Buffer): void {
	const remaining = 8192 - stream.data.length;
	stream.truncated ||= data.length > remaining;
	stream.data = Buffer.concat([stream.data, data.subarray(0, remaining)]);
}
function text(stream: Stream): string {
	const decoded = stream.data.toString("utf8");
	const encoded = Buffer.from(decoded);
	stream.truncated ||= encoded.length > 8192;
	// Avoid a new replacement character from splitting a UTF8 code point.
	let end = Math.min(encoded.length, 8192);
	while (end < encoded.length && ((encoded[end] ?? 0) & 0xc0) === 0x80) end--;
	return encoded.subarray(0, end).toString("utf8");
}
function chunk(frame: Record<string, unknown>): Buffer {
	if (
		typeof frame.dataB64 !== "string" ||
		frame.dataB64.length > 1368 ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
			frame.dataB64,
		)
	)
		throw new Error("Invalid capture chunk.");
	const data = Buffer.from(frame.dataB64, "base64");
	if (data.length > 1024) throw new Error("Oversized capture chunk.");
	return data;
}
export function parseCapture(wire: Buffer, incomplete: boolean): Capture {
	const streams = {
		stdout: { data: Buffer.alloc(0), truncated: false },
		stderr: { data: Buffer.alloc(0), truncated: false },
	};
	let complete = false;
	let advisory = false;
	let malformed = false;
	const bounded = wire.subarray(0, 32768).toString("utf8");
	const lines = bounded.split("\n");
	incomplete ||= wire.length > 32768 || lines.pop() !== "";
	for (const line of lines) {
		try {
			const frame = JSON.parse(line) as Record<string, unknown>;
			if (frame.captureVersion !== 1 || frame.recordType === "operation")
				continue; // Fixed JSON operational logs are not capture frames.
			if (frame.captureComplete === true) {
				complete = true;
				advisory = frame.captureTruncationReported === true;
				continue;
			}
			if (frame.stream !== "stdout" && frame.stream !== "stderr")
				throw new Error("Invalid stream.");
			append(streams[frame.stream], chunk(frame));
		} catch {
			malformed = true;
			break;
		}
	}
	const stdout = text(streams.stdout);
	const stderr = text(streams.stderr);
	return {
		stdout,
		stderr,
		stdoutTruncated: streams.stdout.truncated || incomplete || malformed,
		stderrTruncated: streams.stderr.truncated || incomplete || malformed,
		runnerReportedTruncation: advisory,
		complete: complete && !incomplete && !malformed,
	};
}
