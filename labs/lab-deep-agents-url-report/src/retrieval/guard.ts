import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export type Resolver = (
	hostname: string,
) => Promise<{ address: string; family: number }[]>;
export interface Target {
	url: URL;
	address: string;
	family: number;
}
const blocked = new BlockList();
for (const [address, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const)
	blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
blocked.addSubnet("3fff::", 20, "ipv6");
function isPublic(address: string): boolean {
	const family = isIP(address);
	if (family === 4) return !blocked.check(address, "ipv4");
	return (
		family === 6 &&
		globalV6.check(address, "ipv6") &&
		!blocked.check(address, "ipv6")
	);
}
export async function guardUrl(
	input: string,
	resolve: Resolver = (host) => lookup(host, { all: true }),
): Promise<Target> {
	const url = new URL(input);
	const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		/(^|\.)(localhost|local|internal)$/.test(host)
	) {
		throw new Error("Only public HTTP(S) URLs without credentials are allowed");
	}
	const family = isIP(host);
	const answers = family ? [{ address: host, family }] : await resolve(host);
	if (
		!answers.length ||
		answers.some(
			(answer) =>
				!isPublic(answer.address) || isIP(answer.address) !== answer.family,
		)
	) {
		throw new Error("Only public HTTP(S) destinations are allowed");
	}
	return { url, ...answers[0] };
}
