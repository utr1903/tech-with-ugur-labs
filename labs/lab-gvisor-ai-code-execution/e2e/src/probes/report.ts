import assert from "node:assert/strict";
export type Assertion = {
	name: string;
	layer: string;
	attempted: string;
	status: "passed" | "failed" | "unverified" | "waived";
	evidence: unknown;
};
export type NetworkEvidence = {
	attempted: boolean;
	denied: boolean;
	executedMarker: boolean;
	positiveControlReached: boolean;
	afterControlReached: boolean;
	receivedBytes: number;
	nonce: string;
	listenerNonces: string[];
	destination: string;
	protocol: string;
	port: number;
	policyEvidence: string;
	runtimeEvidence: string;
};
export function validateNetworkEvidence(input: NetworkEvidence): void {
	assert(
		input.attempted && input.denied && input.executedMarker,
		"Submitted probe did not execute or was not denied.",
	);
	assert(
		input.positiveControlReached && input.afterControlReached,
		"Matched live positive controls required.",
	);
	assert.equal(input.receivedBytes, 0, "Attack reached listener.");
	assert(
		input.listenerNonces.includes(`${input.nonce}-before`) &&
			input.listenerNonces.includes(`${input.nonce}-after`),
		"Independent listener nonce observations required.",
	);
	assert(
		input.destination &&
			input.protocol &&
			input.port &&
			input.policyEvidence &&
			input.runtimeEvidence,
		"Destination and independent policy/runtime evidence required.",
	);
}
export function validateExecution(input: {
	status: string;
	marker: boolean;
	exitCode: number | null;
	reason?: string;
}): void {
	assert(input.marker, "Submitted source execution marker required.");
	if (input.status === "succeeded") assert.equal(input.exitCode, 0);
	if (input.status === "oom") assert.equal(input.reason, "OOMKilled");
	if (input.status === "timeout")
		assert.equal(input.reason, "DeadlineExceeded");
}
