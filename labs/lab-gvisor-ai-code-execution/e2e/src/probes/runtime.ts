import assert from "node:assert/strict";
import { docker, json, kube, node, pause, save } from "../lib/commands.js";
import {
	observe,
	type Pod,
	removeJob,
	submitSource,
	waitPod,
} from "../lib/jobs.js";
import { withRuntimeRestoration } from "../lib/runtime-restoration.js";
import type { Assertion } from "./report.js";

async function identity() {
	const name = await submitSource(
		"import time; print('EXECUTED',flush=True); time.sleep(7)",
	);
	try {
		let pod = await waitPod(name);
		for (let n = 0; n < 40; n++) {
			pod = json<Pod>(["get", "pod", pod.metadata.name, "-n", "executor"]);
			if (pod.status?.containerStatuses?.[0]?.state.running) break;
			await pause(200);
		}
		const sandboxId = docker([
			"exec",
			node,
			"crictl",
			"pods",
			"--name",
			`^${pod.metadata.name}$`,
			"--namespace",
			"executor",
			"-q",
		]).trim();
		assert(sandboxId);
		const sandbox = JSON.parse(
			docker(["exec", node, "crictl", "inspectp", sandboxId]),
		);
		assert.equal(sandbox.info.runtimeType, "io.containerd.runsc.v1");
		assert.equal(sandbox.status.metadata.uid, pod.metadata.uid);
		const pid = String(sandbox.info.pid);
		const command = docker([
			"exec",
			node,
			"sh",
			"-c",
			`tr '\\000' ' ' < /proc/${pid}/cmdline`,
		]);
		assert(
			command.includes(sandboxId) &&
				command.includes("--network=none") &&
				command.includes("--platform=systrap"),
		);
		const digest = docker([
			"exec",
			node,
			"sha256sum",
			`/proc/${pid}/exe`,
		]).split(" ")[0];
		const installed = docker([
			"exec",
			node,
			"sha256sum",
			"/usr/local/bin/gvisor-bin/gvisor_sentry",
		]).split(" ")[0];
		assert.equal(digest, installed);
		const checksums = docker([
			"exec",
			node,
			"sha256sum",
			"-c",
			"/usr/local/share/gvisor-runtime.sha256",
		]);
		save("runtime-identity.json", { pod, sandbox, command, digest, checksums });
		const execution = await observe(name);
		assert(execution.stdout.includes("EXECUTED"));
	} finally {
		removeJob(name);
	}
}
export async function runtime(): Promise<Assertion[]> {
	await identity();
	const original = docker(["exec", node, "cat", "/etc/containerd/config.toml"]);
	assert(original.includes("runtimes.runsc"));
	let name = "";
	await withRuntimeRestoration(
		async () => {
			docker(
				["exec", "-i", node, "sh", "-c", "cat > /etc/containerd/config.toml"],
				original.replaceAll("runtimes.runsc", "runtimes.e2e-disabled-runsc"),
			);
			docker(["exec", node, "systemctl", "restart", "containerd"]);
			name = await submitSource("print('MUST-NOT-EXECUTE')");
			const pod = await waitPod(name);
			let events = "";
			for (let n = 0; n < 50; n++) {
				events = kube([
					"get",
					"events",
					"-n",
					"executor",
					"--field-selector",
					`involvedObject.name=${pod.metadata.name}`,
					"-o",
					"json",
				]);
				if (/no runtime for.*runsc/.test(events)) break;
				await pause(250);
			}
			assert(/no runtime for.*runsc/.test(events));
			const actual = json<Pod>([
				"get",
				"pod",
				pod.metadata.name,
				"-n",
				"executor",
			]);
			assert(
				!actual.status?.containerStatuses?.some(
					(c) => c.state.running || c.state.terminated,
				),
			);
			save("runtime-failclosed.json", {
				events: JSON.parse(events),
				pod: actual,
			});
		},
		() => {
			if (name) removeJob(name);
		},
		() => {
			docker(
				["exec", "-i", node, "sh", "-c", "cat > /etc/containerd/config.toml"],
				original,
			);
		},
		() => {
			docker(["exec", node, "systemctl", "restart", "containerd"]);
		},
	);
	const restored = await submitSource("print('EXECUTED');print(42)");
	try {
		const result = await observe(restored);
		assert.equal(result.exitCode, 0);
		assert(result.stdout.includes("42"));
		save("runtime-restored.json", result);
	} finally {
		removeJob(restored);
	}
	return [
		{
			name: "genuine-runtime-failclosed-restored",
			layer: "containerd/gVisor Sentry",
			attempted: "execute; remove handler; execute; restore handler; execute",
			status: "passed",
			evidence: [
				"runtime-identity.json",
				"runtime-failclosed.json",
				"runtime-restored.json",
			],
		},
	];
}
