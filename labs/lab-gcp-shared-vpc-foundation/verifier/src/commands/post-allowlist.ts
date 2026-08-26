import type { VerifierConfig } from "../config/config";
import type { Logger } from "../logger";
import type { ProofResult } from "../proofs/result";

export async function runPostAllowlist(_args: {
	config: VerifierConfig;
	logger: Logger;
}): Promise<ProofResult[]> {
	return []; // Filled in by the egress proof task.
}
