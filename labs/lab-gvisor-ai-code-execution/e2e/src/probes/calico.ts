import assert from "node:assert/strict";
import { docker, json, node, pause, save } from "../lib/commands.js";
import { namespace } from "./network-control.js";
export async function controlDropCounter(name: string) {
	const pod = json<{ status: { podIP: string } }>([
		"get",
		"pod",
		"control",
		"-n",
		namespace,
	]);
	const route = docker([
		"exec",
		node,
		"ip",
		"-4",
		"route",
		"get",
		pod.status.podIP,
	]).split(/\s+/);
	const device = route[route.indexOf("dev") + 1];
	assert(device?.startsWith("cali"));
	for (let n = 0; n < 30; n++) {
		const rules = docker(["exec", node, "iptables-save", "-c"]);
		const line = rules
			.split("\n")
			.find(
				(line) =>
					line.includes(`-A cali-fw-${device} `) &&
					line.includes("End of tier default.") &&
					line.endsWith("-j DROP"),
			);
		if (line) {
			save(`${name}-calico-counter.txt`, { device, line, pod });
			return Number(line.match(/^\[(\d+):/)?.[1]);
		}
		await pause(100);
	}
	throw new Error(
		"Owned ordinary-runtime Pod has no installed Calico default-tier drop counter.",
	);
}
