import { setTimeout as delay } from "node:timers/promises";
import type { Claim } from "./claim.js";
import type { KubernetesApi } from "./kubernetes.js";
import { observe, ownedPods, stopped } from "./observation.js";
export async function cleanup(api: KubernetesApi, claim: Claim): Promise<void> {
	if (!claim.record.held) return;
	if (!claim.record.result)
		throw new Error("Cleanup requires persisted terminal result.");
	await claim.renew();
	const name = `exec-${claim.record.id}`;
	const job = await api.getJob(name);
	if (job) await observe(api, claim, job);
	const uid = claim.record.job_uid;
	// A missing never-observed submission may still arrive. Quarantine the slot.
	if (!uid) return;
	if (job) await api.deleteJob(name, uid);
	const until = Date.now() + 5000;
	do {
		await claim.renew();
		const [remaining, pods] = await Promise.all([
			api.getJob(name),
			api.listPods(name),
		]);
		if (!ownedPods(pods, uid)) throw new Error("Cleanup Pod owner conflict.");
		if (remaining && remaining.metadata?.uid !== uid)
			throw new Error("Cleanup Job UID conflict.");
		if (!remaining && stopped(pods)) {
			await claim.releaseCapacity();
			return;
		}
		await delay(100);
	} while (Date.now() < until);
}
