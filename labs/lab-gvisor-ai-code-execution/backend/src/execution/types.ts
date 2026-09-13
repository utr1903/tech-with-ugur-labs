export type ExecutionStatus =
	| "succeeded"
	| "failed"
	| "timeout"
	| "oom"
	| "rejected";
export type ExecutionResult = {
	executionId: string;
	status: ExecutionStatus;
	stdout: string;
	stderr: string;
	stdoutTruncated: boolean;
	stderrTruncated: boolean;
	exitCode: number | null;
	runnerReportedTruncation: boolean;
};
export type ExecutionInput = {
	threadId: string;
	turnId: string;
	toolCallId: string;
	source: string;
};
export type ExecutePython = (input: ExecutionInput) => Promise<ExecutionResult>;
export type ExecutionRecord = {
	id: string;
	thread_id: string;
	turn_id: string;
	tool_call_id: string;
	source: string;
	source_hash: string;
	template_hash: string;
	phase: "reserved" | "submitting" | "observed" | "terminal";
	held: boolean;
	job_uid: string | null;
	pod_uid: string | null;
	fence: number;
	lease_until: Date | null;
	deadline: Date;
	result: ExecutionResult | null;
	log_budget: number;
};
export function emptyResult(
	executionId: string,
	status: ExecutionStatus,
	stderr = "",
): ExecutionResult {
	return {
		executionId,
		status,
		stdout: "",
		stderr,
		stdoutTruncated: false,
		stderrTruncated: false,
		exitCode: null,
		runnerReportedTruncation: false,
	};
}
