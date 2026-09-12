import type { V1Job } from "@kubernetes/client-node";
import type { Logger } from "../logger.js";
import type { Claim } from "./claim.js";
import { type KubernetesApi, KubernetesError } from "./kubernetes.js";
import { observe } from "./observation.js";
import { buildJob } from "./template.js";
import { type ExecutionResult, emptyResult } from "./types.js";
export async function submit(
	api: KubernetesApi,
	claim: Claim,
	logger: Logger,
	signal?: AbortSignal,
): Promise<ExecutionResult | null> {
	const expired = Date.now() >= claim.record.deadline.getTime();
	if (signal?.aborted || expired) {
		const result = emptyResult(
			claim.record.id,
			expired ? "timeout" : "failed",
			"Execution stopped before submission.",
		);
		await claim.finish(result);
		await claim.releaseCapacity();
		return result;
	}
	// Durable intent always precedes the sole create attempt.
	await claim.update({ phase: "submitting" });
	let created: V1Job;
	try {
		created = await api.createJob(
			buildJob({
				executionId: claim.record.id,
				source: claim.record.source,
			}),
		);
	} catch (err) {
		if (
			err instanceof KubernetesError &&
			[400, 401, 403, 404, 405, 413, 422, 429].includes(err.status)
		) {
			const result = emptyResult(
				claim.record.id,
				"rejected",
				"Kubernetes rejected execution admission.",
			);
			await claim.finish(result);
			await claim.releaseCapacity();
			return result;
		}
		logger.warn(
			{ err, executionId: claim.record.id },
			"Submitting execution outcome uncertain.",
		);
		return null;
	}
	await observe(api, claim, created);
	return null;
}
