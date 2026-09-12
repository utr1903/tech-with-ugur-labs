import type { V1Pod } from "@kubernetes/client-node";
import type { Logger } from "../logger.js";
import { parseCapture } from "./capture.js";
import type { Claim } from "./claim.js";
import type { KubernetesApi } from "./kubernetes.js";
import type { ExecutionResult, ExecutionStatus } from "./types.js";
export async function collectResult(
	api: KubernetesApi,
	claim: Claim,
	pod: V1Pod | undefined,
	status: ExecutionStatus,
	exitCode: number | null,
	logger: Logger,
): Promise<ExecutionResult> {
	let wire: { data: Buffer; incomplete: boolean } = {
		data: Buffer.alloc(0),
		incomplete: true,
	};
	const name = pod?.metadata?.name;
	const uid = pod?.metadata?.uid;
	const budget = claim.record.log_budget;
	if (name && uid && budget > 0) {
		// Reserve the entire read BEFORE I/O. Restart/retry cannot reset the budget.
		await claim.update({ log_budget: 0 });
		const before = await api.getPod(name);
		if (before?.metadata?.uid !== uid)
			throw new Error("Log Pod identity changed.");
		try {
			wire = await api.readLogs(name, budget);
		} catch (err) {
			logger.warn(
				{ executionId: claim.record.id, err },
				"Reading execution logs failed.",
			);
		}
		const after = await api.getPod(name);
		if (after?.metadata?.uid !== uid)
			throw new Error("Log Pod identity changed.");
	}
	const capture = parseCapture(wire.data, wire.incomplete);
	return {
		executionId: claim.record.id,
		status: status === "succeeded" && !capture.complete ? "failed" : status,
		exitCode,
		stdout: capture.stdout,
		stderr: capture.stderr,
		stdoutTruncated: capture.stdoutTruncated,
		stderrTruncated: capture.stderrTruncated,
		runnerReportedTruncation: capture.runnerReportedTruncation,
	};
}
