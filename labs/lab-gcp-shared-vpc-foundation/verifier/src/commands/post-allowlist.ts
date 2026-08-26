import type { VerifierConfig } from "../config/config";
import type { Logger } from "../logger";
import { proveNoCrossProjectWorkloads } from "../proofs/cross-project-workload";
import { proveEgressOnlyViaProxy } from "../proofs/egress";
import { proveIngressAllowed } from "../proofs/ingress";
import { proveNetworkAuthority } from "../proofs/network-authority";
import type { ProofResult } from "../proofs/result";
import { proveNoSubnetBorrowing } from "../proofs/subnet-borrowing";

export async function runPostAllowlist(args: {
	config: VerifierConfig;
	logger: Logger;
}): Promise<ProofResult[]> {
	const results: ProofResult[] = [];
	results.push(...(await proveNetworkAuthority(args)));
	results.push(await proveNoCrossProjectWorkloads(args));
	results.push(await proveNoSubnetBorrowing(args));
	results.push(...(await proveIngressAllowed(args)));
	results.push(...(await proveEgressOnlyViaProxy(args)));
	return results;
}
