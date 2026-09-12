import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { docker, json, kube, node, save } from "../lib/commands.js";
import { runSource } from "../lib/jobs.js";
import { packets, startListeners, stopListeners } from "../lib/network-host.js";
import { controlDropCounter } from "./calico.js";
import { ipv6Configuration } from "./ipv6.js";
import {
	namespace,
	ordinary,
	policy,
	setupControl,
} from "./network-control.js";
import { networkSource, type Target } from "./network-source.js";
import { targets } from "./network-targets.js";
import { type Assertion, validateNetworkEvidence } from "./report.js";

function response(stdout: string) {
	assert(stdout.includes("EXECUTED"));
	return JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
}
async function checkRoute(target: Target): Promise<Assertion[]> {
	const nonce = `e2eprobe${randomUUID().replaceAll("-", "").slice(0, 16)}`;
	policy(false);
	const before = response(ordinary(networkSource(target, `${nonce}-before`)));
	const runner = await runSource(networkSource(target, `${nonce}-attack`));
	const denied = response(runner.stdout);
	policy(true);
	const dropBefore = await controlDropCounter(`${target.name}-before`);
	const runc = response(ordinary(networkSource(target, `${nonce}-runc`)));
	const dropAfter = await controlDropCounter(`${target.name}-after`);
	assert(
		dropAfter > dropBefore,
		"No independently observed Calico DROP for owned control Pod.",
	);
	const policyFile = save(
		`${target.name}-policy.json`,
		json(["get", "networkpolicy", "-n", namespace]),
	);
	const rules = save(
		`${target.name}-iptables.txt`,
		docker(["exec", node, "iptables-save", "-c"]),
	);
	policy(false);
	const after = response(ordinary(networkSource(target, `${nonce}-after`)));
	const captured = packets();
	save(`${target.name}-packets.jsonl`, captured);
	const bytes = captured
		.split("\n")
		.filter(Boolean)
		.map((line) => Buffer.from(JSON.parse(line).hex, "hex"));
	const seen = (token: string) =>
		bytes.some((data) => data.includes(Buffer.from(token)));
	const observed = {
		before,
		after,
		denied,
		runc,
		runner: `${runner.name}.json`,
		policyFile,
		rules,
		nonce,
		target,
		dropBefore,
		dropAfter,
	};
	save(`${target.name}-network.json`, observed);
	if (!before.reached || !after.reached)
		return [
			{
				name: target.name,
				layer: "network",
				attempted: JSON.stringify(target),
				status: "unverified",
				evidence: observed,
			},
		];
	validateNetworkEvidence({
		attempted: true,
		denied: !denied.reached,
		executedMarker: runner.stdout.includes("EXECUTED"),
		positiveControlReached: before.reached,
		afterControlReached: after.reached,
		receivedBytes: seen(`${nonce}-attack`) ? 1 : 0,
		nonce,
		listenerNonces: ["before", "after"]
			.filter((s) => seen(`${nonce}-${s}`))
			.map((s) => `${nonce}-${s}`),
		destination: target.address,
		protocol: target.protocol,
		port: target.port,
		policyEvidence: policyFile,
		runtimeEvidence: "runtime-identity.json",
	});
	assert(!runc.reached, "Ordinary runtime bypassed Calico default deny.");
	return [
		{
			name: target.name,
			layer:
				"gVisor network=none and independent ordinary-runtime Calico default-deny",
			attempted: JSON.stringify(target),
			status: "passed",
			evidence: observed,
		},
	];
}
export async function network(): Promise<Assertion[]> {
	const nodeIp = json<{
		status: { addresses: { type: string; address: string }[] };
	}>(["get", "node", node]).status.addresses.find(
		(a) => a.type === "InternalIP",
	)?.address;
	assert(nodeIp);
	const gateway = docker(["exec", node, "sh", "-c", "ip -4 route show default"])
		.trim()
		.split(/\s+/)[2];
	assert(gateway);
	const destinations = [gateway, "169.254.169.254", "198.18.0.1"];
	const results: Assertion[] = [];
	kube(["create", "namespace", namespace]);
	try {
		setupControl();
		startListeners(destinations, nodeIp);
		save(
			"executor-network-policy.json",
			json(["get", "networkpolicy", "-n", "executor"]),
		);
		for (const target of targets(nodeIp, gateway))
			results.push(...(await checkRoute(target)));
		results.push(
			ipv6Configuration(
				ordinary(
					"import socket;print(socket.has_ipv6);print(open('/proc/net/ipv6_route').read())",
				),
			),
		);
		const internet = docker([
			"exec",
			node,
			"python3",
			"-c",
			"import urllib.request; r=urllib.request.urlopen('https://example.com',timeout=10); print(r.status)",
		]);
		save("harmless-internet.txt", internet);
		return results;
	} finally {
		try {
			stopListeners();
		} finally {
			kube(["delete", "namespace", namespace, "--wait=true", "--timeout=60s"]);
		}
	}
}
