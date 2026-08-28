import { InstancesClient } from "@google-cloud/compute";
import type { VerifierConfig } from "../config/config";
import { isPermissionDenied } from "../gcp/errors";
import { impersonatedAuth } from "../gcp/impersonate";
import { expectConsistentDenial } from "../lib/retry";
import type { Logger } from "../logger";
import { probeInstance } from "./cross-project-workload";
import type { ProofResult } from "./result";

export async function proveNoSubnetBorrowing({
	config,
	logger,
}: {
	config: VerifierConfig;
	logger: Logger;
}): Promise<ProofResult> {
	const proofLogger = logger.child({ proof: "subnet-borrowing" });
	const expectation =
		"service-A SA is denied attaching a VM in its own project to service B's subnet";

	try {
		proofLogger.info(
			{ sa: config.serviceASaEmail, subnet: config.subnetBSelfLink },
			"Proving subnet borrowing denial...",
		);
		const auth = await impersonatedAuth(config.serviceASaEmail);
		const instances = new InstancesClient({ auth });

		const denial = await expectConsistentDenial(
			() =>
				instances.insert({
					project: config.serviceAProjectId,
					zone: config.vmZone,
					instanceResource: probeInstance(
						"probe-borrowed-subnet",
						config.vmZone,
						config.subnetBSelfLink,
					),
				}),
			{ isExpectedDenial: isPermissionDenied },
		);

		proofLogger.info(
			{ denied: denial.deniedConsistently },
			"Proving subnet borrowing denial finished.",
		);
		return {
			proof: "subnet-borrowing",
			expectation,
			passed: denial.deniedConsistently,
			detail: denial.detail,
		};
	} catch (err) {
		proofLogger.error({ err }, "Proving subnet borrowing denial failed.");
		return {
			proof: "subnet-borrowing",
			expectation,
			passed: false,
			detail: String(err),
		};
	}
}
