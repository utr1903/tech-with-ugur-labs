import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { V1Job } from "@kubernetes/client-node";

const fixed = JSON.parse(
	readFileSync(
		new URL("../../../runtime/runner-job.json", import.meta.url),
		"utf8",
	),
) as V1Job;
export const templateDigest = createHash("sha256")
	.update(JSON.stringify(fixed))
	.digest("hex");
export function sourceDigest(source: string): string {
	if (Buffer.byteLength(source) > 16384 || source.includes("\0"))
		throw new Error("Invalid source: maximum 16384 UTF8 bytes, no NUL.");
	return createHash("sha256").update(source).digest("hex");
}
export function buildJob(input: {
	executionId: string;
	source: string;
}): V1Job {
	sourceDigest(input.source);
	if (!/^[a-f0-9]{32}$/.test(input.executionId))
		throw new Error("Invalid execution identity.");
	const job = structuredClone(fixed);
	job.metadata = {
		name: `exec-${input.executionId}`,
		namespace: "executor",
		labels: { "execution-id": input.executionId },
	};
	const spec = job.spec?.template.spec;
	if (!spec?.containers[0]) throw new Error("Invalid fixed runner template.");
	spec.containers[0].env = [{ name: "PYTHON_SOURCE", value: input.source }];
	return job;
}
// The API defaults additional fields. Every submitted field must match; admission
// independently rejects extra policy fields on both Jobs and Pods.
function contains(actual: unknown, expected: unknown): boolean {
	if (expected === null || typeof expected !== "object")
		return actual === expected;
	if (actual === null || typeof actual !== "object") return false;
	if (Array.isArray(expected))
		return (
			Array.isArray(actual) &&
			actual.length === expected.length &&
			expected.every((value, i) => contains(actual[i], value))
		);
	return Object.entries(expected).every(([key, value]) =>
		contains((actual as Record<string, unknown>)[key], value),
	);
}
export function matchesJob(
	job: V1Job,
	executionId: string,
	source: string,
): boolean {
	return contains(job, buildJob({ executionId, source }));
}
