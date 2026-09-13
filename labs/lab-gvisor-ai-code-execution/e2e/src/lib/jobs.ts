import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { json, kube, pause, runnerTemplate, save } from "./commands.js";
export type Pod = {
	metadata: { name: string; uid: string };
	spec: { nodeName: string; containers: { image: string }[] };
	status?: {
		podIP?: string;
		containerStatuses?: {
			containerID?: string;
			state: {
				running?: unknown;
				terminated?: { exitCode: number; reason: string };
			};
		}[];
	};
};
export type JobObservation = {
	name: string;
	pod: Pod;
	stdout: string;
	stderr: string;
	logs: string;
	exitCode: number | null;
	reason: string;
	job: unknown;
};
export async function submitSource(
	source: string,
	name = `e2e-${randomUUID().slice(0, 12)}`,
): Promise<string> {
	const job = runnerTemplate();
	job.metadata.name = name;
	job.spec.template.spec.containers[0].env[0].value = source;
	kube(
		["create", "--as=system:serviceaccount:executor-app:backend", "-f", "-"],
		JSON.stringify(job),
	);
	return name;
}
export async function waitPod(
	name: string,
	namespace = "executor",
): Promise<Pod> {
	for (let attempt = 0; attempt < 80; attempt++) {
		const pods = json<{ items: Pod[] }>([
			"get",
			"pods",
			"-n",
			namespace,
			"-l",
			`job-name=${name}`,
		]);
		if (pods.items[0]) return pods.items[0];
		await pause(250);
	}
	throw new Error("Job did not create a Pod.");
}
function decode(logs: string, stream: string) {
	const chunks: Buffer[] = [];
	for (const line of logs.split("\n")) {
		try {
			const frame = JSON.parse(line);
			if (frame.captureVersion === 1 && frame.stream === stream)
				chunks.push(Buffer.from(frame.dataB64, "base64"));
		} catch {
			/* Incomplete final line is retained in raw evidence. */
		}
	}
	return Buffer.concat(chunks).subarray(0, 8192).toString("utf8");
}
export async function observe(name: string): Promise<JobObservation> {
	let pod = await waitPod(name);
	let logs = "";
	let budget = 32768;
	const deadline = Date.now() + 40000;
	while (Date.now() < deadline) {
		const current = json<{ items: Pod[] }>([
			"get",
			"pods",
			"-n",
			"executor",
			"--field-selector",
			`metadata.name=${pod.metadata.name}`,
		]).items[0];
		if (!current) break;
		pod = current;
		const state = pod.status?.containerStatuses?.[0]?.state;
		if ((state?.running || state?.terminated) && budget > 0) {
			const next = kube([
				"logs",
				pod.metadata.name,
				"-n",
				"executor",
				`--limit-bytes=${budget}`,
			]);
			budget -= Buffer.byteLength(next);
			if (next.length > logs.length) logs = next;
		}
		if (state?.terminated) break;
		await pause(500);
	}
	const result = finishObservation(name, pod, logs);
	save(`${name}.json`, result);
	return result;
}
function finishObservation(
	name: string,
	pod: Pod,
	logs: string,
): JobObservation {
	const terminated = pod.status?.containerStatuses?.[0]?.state.terminated;
	const job = json<{ status?: { conditions?: { reason?: string }[] } }>([
		"get",
		"job",
		name,
		"-n",
		"executor",
	]);
	const deadlineReached = job.status?.conditions?.some(
		(c) => c.reason === "DeadlineExceeded",
	);
	assert(
		terminated || deadlineReached,
		"No independently observed termination.",
	);
	return {
		name,
		pod,
		stdout: decode(logs, "stdout"),
		stderr: decode(logs, "stderr"),
		logs,
		exitCode: terminated?.exitCode ?? null,
		reason: deadlineReached
			? "DeadlineExceeded"
			: (terminated?.reason ?? "Unknown"),
		job,
	};
}
export function removeJob(name: string) {
	kube([
		"delete",
		"job",
		name,
		"-n",
		"executor",
		"--ignore-not-found",
		"--wait=true",
		"--cascade=foreground",
		"--timeout=45s",
	]);
}
export async function runSource(source: string) {
	const name = await submitSource(source);
	try {
		return await observe(name);
	} finally {
		removeJob(name);
	}
}
