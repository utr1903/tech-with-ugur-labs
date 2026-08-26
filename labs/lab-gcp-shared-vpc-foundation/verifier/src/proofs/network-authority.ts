import { FirewallsClient, GlobalOperationsClient } from "@google-cloud/compute";
import type { VerifierConfig } from "../config/config";
import { isPermissionDenied } from "../gcp/errors";
import { impersonatedAuth } from "../gcp/impersonate";
import { expectConsistentDenial, retryUntilSuccess } from "../lib/retry";
import type { Logger } from "../logger";
import type { ProofResult } from "./result";

const PROBE_NAME = "probe-host-authority";

function probeFirewall(config: VerifierConfig) {
	return {
		name: PROBE_NAME,
		network: config.networkSelfLink,
		allowed: [{ IPProtocol: "tcp", ports: ["9999"] }],
		sourceRanges: ["10.0.0.0/8"],
		description:
			"Temporary probe proving network authority; deleted by the verifier.",
	};
}

async function waitForGlobalOp(
	auth: Awaited<ReturnType<typeof impersonatedAuth>>,
	project: string,
	operation: string,
) {
	const operations = new GlobalOperationsClient({ auth });
	await operations.wait({ project, operation });
}

export async function proveNetworkAuthority({
	config,
	logger,
}: {
	config: VerifierConfig;
	logger: Logger;
}): Promise<ProofResult[]> {
	const proofLogger = logger.child({ proof: "network-authority" });
	const results: ProofResult[] = [];

	try {
		proofLogger.info(
			{ sa: config.hostSaEmail },
			"Proving host network authority...",
		);
		const hostAuth = await impersonatedAuth(config.hostSaEmail);
		const hostFirewalls = new FirewallsClient({ auth: hostAuth });

		await retryUntilSuccess(async () => {
			const [op] = await hostFirewalls.insert({
				project: config.hostProjectId,
				firewallResource: probeFirewall(config),
			});
			await waitForGlobalOp(hostAuth, config.hostProjectId, op.name as string);
		});
		const [deleteOp] = await hostFirewalls.delete({
			project: config.hostProjectId,
			firewall: PROBE_NAME,
		});
		await waitForGlobalOp(
			hostAuth,
			config.hostProjectId,
			deleteOp.name as string,
		);

		results.push({
			proof: "network-authority",
			expectation:
				"host SA can create and delete a firewall rule on the shared VPC",
			passed: true,
			detail: `created and deleted ${PROBE_NAME}`,
		});
		proofLogger.info({}, "Proving host network authority succeeded.");
	} catch (err) {
		proofLogger.error({ err }, "Proving host network authority failed.");
		results.push({
			proof: "network-authority",
			expectation:
				"host SA can create and delete a firewall rule on the shared VPC",
			passed: false,
			detail: String(err),
		});
	}

	try {
		proofLogger.info(
			{ sa: config.serviceASaEmail },
			"Proving service SA lacks network authority...",
		);
		const serviceAuth = await impersonatedAuth(config.serviceASaEmail);
		const serviceFirewalls = new FirewallsClient({ auth: serviceAuth });

		const denial = await expectConsistentDenial(
			async () => {
				const [op] = await serviceFirewalls.insert({
					project: config.hostProjectId,
					firewallResource: probeFirewall(config),
				});
				await waitForGlobalOp(
					serviceAuth,
					config.hostProjectId,
					op.name as string,
				);
			},
			{ isExpectedDenial: isPermissionDenied },
		);

		results.push({
			proof: "network-authority",
			expectation: "service-A SA is denied firewall creation on the shared VPC",
			passed: denial.deniedConsistently,
			detail: denial.detail,
		});
		proofLogger.info(
			{ denied: denial.deniedConsistently },
			"Proving service SA lacks network authority finished.",
		);
	} catch (err) {
		proofLogger.error(
			{ err },
			"Proving service SA lacks network authority failed.",
		);
		results.push({
			proof: "network-authority",
			expectation: "service-A SA is denied firewall creation on the shared VPC",
			passed: false,
			detail: String(err),
		});
	}

	return results;
}
