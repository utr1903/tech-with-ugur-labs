import type { V1Job, V1Pod } from "@kubernetes/client-node";
import type { Claim } from "./claim.js";
import type { KubernetesApi } from "./kubernetes.js";
import { matchesJob } from "./template.js";
import type { ExecutionRecord, ExecutionStatus } from "./types.js";
export function ownedPods(pods: V1Pod[], uid: string): boolean {
	return pods.every((pod) =>
		pod.metadata?.ownerReferences?.some(
			(owner) =>
				owner.controller === true && owner.kind === "Job" && owner.uid === uid,
		),
	);
}
export function stopped(pods: V1Pod[]): boolean {
	return pods.every(
		(pod) =>
			pod.status?.phase === "Succeeded" || pod.status?.phase === "Failed",
	);
}
export async function observe(
	api: KubernetesApi,
	claim: Claim,
	job: V1Job,
): Promise<V1Pod[]> {
	const row = claim.record;
	const uid = job.metadata?.uid;
	if (
		!uid ||
		!matchesJob(job, row.id, row.source) ||
		(row.job_uid !== null && row.job_uid !== uid)
	)
		throw new Error("Execution Job identity/template conflict.");
	if (!row.job_uid)
		await claim.update({
			job_uid: uid,
			phase: row.result ? "terminal" : "observed",
		});
	const pods = await api.listPods(`exec-${row.id}`);
	if (!ownedPods(pods, uid) || pods.length > 1)
		throw new Error("Execution Pod controller identity conflict.");
	const pod = pods[0];
	if (pod) {
		if (
			!pod.metadata?.uid ||
			(row.pod_uid !== null && row.pod_uid !== pod.metadata.uid)
		)
			throw new Error("Execution Pod identity conflict.");
		if (!row.pod_uid) await claim.update({ pod_uid: pod.metadata.uid });
	}
	return pods;
}
export function classification(
	job: V1Job,
	pod: V1Pod | undefined,
	row: ExecutionRecord,
	aborted: boolean,
): { status: ExecutionStatus; exitCode: number | null } | null {
	const terminated = pod?.status?.containerStatuses?.find(
		(container) => container.name === "runner",
	)?.state?.terminated;
	const exitCode = terminated?.exitCode ?? null;
	if (terminated?.reason === "OOMKilled") return { status: "oom", exitCode };
	if (
		job.status?.conditions?.some(
			(c) => c.status === "True" && c.reason === "DeadlineExceeded",
		)
	)
		return { status: "timeout", exitCode };
	if (terminated)
		return { status: exitCode === 0 ? "succeeded" : "failed", exitCode };
	if (aborted) return { status: "failed", exitCode };
	const started = pod?.status?.containerStatuses?.find(
		(container) => container.name === "runner",
	)?.state?.running?.startedAt;
	const deadline = Math.min(
		row.deadline.getTime(),
		started ? new Date(started).getTime() + 10000 : Infinity,
	);
	if (Date.now() >= deadline) return { status: "timeout", exitCode };
	if (
		job.status?.conditions?.some(
			(c) => c.status === "True" && c.type === "Failed",
		)
	)
		return { status: "failed", exitCode };
	return null;
}
