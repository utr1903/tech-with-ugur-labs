import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import {
	buildJob,
	matchesJob,
	sourceDigest,
	templateDigest,
} from "./template.js";

describe("fixed execution template", () => {
	it("owns policy fields even when caller supplies extra fields", () => {
		const input = {
			executionId: "a".repeat(32),
			source: "print(42)",
			namespace: "default",
			image: "evil",
			command: ["sh"],
		};
		const job = buildJob(input);
		expect(job.metadata).toMatchObject({
			name: `exec-${"a".repeat(32)}`,
			namespace: "executor",
		});
		expect(job.spec).toMatchObject({
			backoffLimit: 0,
			activeDeadlineSeconds: 20,
		});
		expect(job.spec?.template.spec).toMatchObject({
			runtimeClassName: "gvisor",
			automountServiceAccountToken: false,
			serviceAccountName: "runner",
		});
		expect(job.spec?.template.spec?.containers[0]?.command).toEqual([
			"python",
			"-I",
			"-B",
			"-m",
			"app",
		]);
	});
	it("enforces UTF8 source bytes before hashing or submitting", () => {
		expect(() => sourceDigest("é".repeat(8193))).toThrow(/source/i);
		expect(() =>
			buildJob({ executionId: "a".repeat(32), source: "x".repeat(16385) }),
		).toThrow(/source/i);
		expect(sourceDigest("é".repeat(8192))).toHaveLength(64);
	});
	it("matches source and fixed fields and rejects a substituted container", () => {
		const job = buildJob({ executionId: "b".repeat(32), source: "print(42)" });
		expect(matchesJob(job, "b".repeat(32), "print(42)")).toBe(true);
		const container = job.spec?.template.spec?.containers[0];
		assert(container);
		container.image = "evil";
		expect(matchesJob(job, "b".repeat(32), "print(42)")).toBe(false);
		expect(templateDigest).toHaveLength(64);
	});
});
