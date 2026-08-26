import type { VerifierConfig } from "../config/config";
import type { Logger } from "../logger";
import { proveIngressDenied } from "../proofs/ingress";
import type { ProofResult } from "../proofs/result";

export async function runPreAllowlist(args: {
	config: VerifierConfig;
	logger: Logger;
}): Promise<ProofResult[]> {
	return [await proveIngressDenied(args)];
}
