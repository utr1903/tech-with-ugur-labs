import assert from "node:assert/strict";
import { docker, json, kube, node, pause, save } from "./commands.js";
export async function crashBackend(evidencePrefix = "browser") {
	const pod = json<{
		items: {
			metadata: { name: string; uid: string };
			status: { containerStatuses: { containerID: string }[] };
		}[];
	}>(["get", "pods", "-n", "executor-app", "-l", "app=chat-backend"]).items[0];
	assert(pod);
	const container = pod.status.containerStatuses[0]?.containerID.replace(
		"containerd://",
		"",
	);
	assert(container);
	const row = docker(["exec", node, "ctr", "-n", "k8s.io", "tasks", "list"])
		.split("\n")
		.find((line) => line.startsWith(container));
	assert(row);
	const pid = row.trim().split(/\s+/)[1];
	assert(pid && /^\d+$/.test(pid));
	save(`${evidencePrefix}-backend-before-crash.json`, { pod, container, pid });
	kube([
		"delete",
		"pod",
		pod.metadata.name,
		"-n",
		"executor-app",
		"--grace-period=0",
		"--force",
		"--wait=false",
	]);
	for (let n = 0; n < 100; n++) {
		const state = JSON.parse(
			docker([
				"exec",
				node,
				"crictl",
				"ps",
				"-a",
				"--name",
				"backend",
				"-o",
				"json",
			]),
		) as { containers: { id: string; state: string }[] };
		const old = state.containers.find((c) => c.id === container);
		const process = docker([
			"exec",
			node,
			"sh",
			"-c",
			`test -e /proc/${pid} && printf present || printf absent`,
		]);
		if ((!old || old.state === "CONTAINER_EXITED") && process === "absent") {
			save(`${evidencePrefix}-backend-crash-proof.json`, {
				oldPodUid: pod.metadata.uid,
				container,
				pid,
				oldContainerState: old?.state ?? "removed",
				process,
			});
			kube([
				"rollout",
				"status",
				"deployment/chat-backend",
				"-n",
				"executor-app",
				"--timeout=120s",
			]);
			return;
		}
		await pause(100);
	}
	throw new Error(
		"Old backend process did not terminate; no crash recovery claim is permitted.",
	);
}
