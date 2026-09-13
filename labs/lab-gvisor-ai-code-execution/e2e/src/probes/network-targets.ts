import { json } from "../lib/commands.js";
import type { Target } from "./network-source.js";
export function targets(nodeIp: string, gateway: string): Target[] {
	const list: Target[] = [];
	for (const [name, port, payload] of [
		["chat-backend", 3001, "http"],
		["chat-postgres", 5432, "pg"],
	] as const) {
		const pods = json<{ items: { status: { podIP: string } }[] }>([
			"get",
			"pods",
			"-n",
			"executor-app",
			"-l",
			`app=${name}`,
		]);
		const service = json<{ spec: { clusterIP: string } }>([
			"get",
			"service",
			name,
			"-n",
			"executor-app",
		]);
		list.push(
			{
				name: `${name}-pod`,
				address: pods.items[0]?.status.podIP ?? "",
				port,
				protocol: "tcp",
				payload,
			},
			{
				name: `${name}-service`,
				address: service.spec.clusterIP,
				port,
				protocol: "tcp",
				payload,
			},
		);
	}
	const api = json<{ spec: { clusterIP: string } }>([
		"get",
		"service",
		"kubernetes",
		"-n",
		"default",
	]);
	const dns = json<{ spec: { clusterIP: string } }>([
		"get",
		"service",
		"kube-dns",
		"-n",
		"kube-system",
	]);
	list.push({
		name: "api",
		address: api.spec.clusterIP,
		port: 443,
		protocol: "tcp",
		payload: "http",
	});
	for (const protocol of ["tcp", "udp"] as const) {
		list.push({
			name: `dns-${protocol}`,
			address: dns.spec.clusterIP,
			port: 53,
			protocol,
			payload: "dns",
		});
		for (const [name, address] of [
			["node", nodeIp],
			["gateway", gateway],
			["metadata", "169.254.169.254"],
			["external-controlled", "198.18.0.1"],
		])
			list.push({
				name: `${name}-${protocol}`,
				address: address ?? "",
				port: protocol === "tcp" ? 18080 : 18081,
				protocol,
				payload: "http",
			});
	}
	return list;
}
