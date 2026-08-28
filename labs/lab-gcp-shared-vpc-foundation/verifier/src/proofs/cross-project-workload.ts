import { InstancesClient } from "@google-cloud/compute";
import type { VerifierConfig } from "../config/config";
import { isPermissionDenied } from "../gcp/errors";
import { impersonatedAuth } from "../gcp/impersonate";
import { expectConsistentDenial } from "../lib/retry";
import type { Logger } from "../logger";
import type { ProofResult } from "./result";

export function probeInstance(name: string, zone: string, subnetwork: string) {
	return {
		name,
		machineType: `zones/${zone}/machineTypes/e2-micro`,
		disks: [
			{
				boot: true,
				autoDelete: true,
				initializeParams: {
					sourceImage:
						"projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64",
				},
			},
		],
		networkInterfaces: [{ subnetwork }],
	};
}

export async function proveNoCrossProjectWorkloads({
	config,
	logger,
}: {
	config: VerifierConfig;
	logger: Logger;
}): Promise<ProofResult> {
	const proofLogger = logger.child({ proof: "cross-project-workload" });
	const expectation =
		"service-A SA is denied creating a VM in service project B";

	try {
		proofLogger.info(
			{ sa: config.serviceASaEmail, target: config.serviceBProjectId },
			"Proving cross-project workload denial...",
		);
		const auth = await impersonatedAuth(config.serviceASaEmail);
		const instances = new InstancesClient({ auth });

		const denial = await expectConsistentDenial(
			() =>
				instances.insert({
					project: config.serviceBProjectId,
					zone: config.vmZone,
					instanceResource: probeInstance(
						"probe-cross-project",
						config.vmZone,
						config.subnetBSelfLink,
					),
				}),
			{ isExpectedDenial: isPermissionDenied },
		);

		proofLogger.info(
			{ denied: denial.deniedConsistently },
			"Proving cross-project workload denial finished.",
		);
		return {
			proof: "cross-project-workload",
			expectation,
			passed: denial.deniedConsistently,
			detail: denial.detail,
		};
	} catch (err) {
		proofLogger.error({ err }, "Proving cross-project workload denial failed.");
		return {
			proof: "cross-project-workload",
			expectation,
			passed: false,
			detail: String(err),
		};
	}
}
