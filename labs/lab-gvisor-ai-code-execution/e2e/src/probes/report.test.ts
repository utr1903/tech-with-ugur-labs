import { describe, expect, it } from "vitest";
import { validateExecution, validateNetworkEvidence } from "./report.js";

const valid = {
	attempted: true,
	denied: true,
	executedMarker: true,
	positiveControlReached: true,
	afterControlReached: true,
	receivedBytes: 0,
	nonce: "unique-test",
	listenerNonces: ["unique-test-before", "unique-test-after"],
	destination: "10.0.0.2",
	protocol: "tcp",
	port: 8080,
	policyEvidence: "policy.json",
	runtimeEvidence: "runtime.json",
};
describe("network report evidence", () => {
	it("refuses a denial without a reachable control", () =>
		expect(() =>
			validateNetworkEvidence({ ...valid, positiveControlReached: false }),
		).toThrow());
	it("refuses dead after-controls, missing execution and arriving attack bytes", () => {
		for (const bad of [
			{ afterControlReached: false },
			{ executedMarker: false },
			{ receivedBytes: 1 },
			{ policyEvidence: "" },
			{ runtimeEvidence: "" },
			{ listenerNonces: [] },
		])
			expect(() => validateNetworkEvidence({ ...valid, ...bad })).toThrow();
	});
	it("accepts independently recorded matched controls", () =>
		expect(() => validateNetworkEvidence(valid)).not.toThrow());
});
it("rejects source-written success and sentinel exit claims", () => {
	for (const input of [
		{ status: "succeeded", marker: false, exitCode: 0 },
		{ status: "oom", marker: true, exitCode: 137, reason: "Error" },
		{ status: "timeout", marker: true, exitCode: 124, reason: "Error" },
	])
		expect(() => validateExecution(input)).toThrow();
});
it("accepts independently observed deadline and OOM with executed marker", () => {
	validateExecution({
		status: "oom",
		marker: true,
		exitCode: 137,
		reason: "OOMKilled",
	});
	validateExecution({
		status: "timeout",
		marker: true,
		exitCode: 137,
		reason: "DeadlineExceeded",
	});
});
