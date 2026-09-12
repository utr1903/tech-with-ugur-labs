import assert from "node:assert/strict";
import { docker, json, node, save } from "../lib/commands.js";
import type { Assertion } from "./report.js";
export function ipv6Configuration(control: string): Assertion {
	const routes = docker(["exec", node, "ip", "-6", "route"]);
	const actualNode = json<{ spec: { podCIDRs: string[] } }>([
		"get",
		"node",
		node,
	]);
	const service = json<{ spec: { ipFamilies: string[] } }>([
		"get",
		"service",
		"kubernetes",
		"-n",
		"default",
	]);
	assert(actualNode.spec.podCIDRs.every((cidr) => !cidr.includes(":")));
	assert.deepEqual(service.spec.ipFamilies, ["IPv4"]);
	assert(
		routes
			.split("\n")
			.filter(Boolean)
			.every((route) => route.startsWith("fe80::/64 ")),
	);
	save("ipv6-configuration.json", {
		routes,
		node: actualNode,
		service,
		control,
	});
	return {
		name: "ipv6-configuration",
		layer: "IPv4-only cluster and absent routed IPv6",
		attempted: "inspect actual Pod CIDRs, service family, node/control routes",
		status: "passed",
		evidence: {
			file: "ipv6-configuration.json",
			scope:
				"No routed IPv6 targets configured; link-local/loopback and socket.has_ipv6 remain available. This is unavailability, not a tested IPv6 firewall denial.",
		},
	};
}
