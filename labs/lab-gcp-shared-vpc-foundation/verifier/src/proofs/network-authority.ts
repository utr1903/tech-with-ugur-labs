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

function isNotFound(err: unknown): boolean {
	if (typeof err !== "object" || err === null) return false;
	const candidate = err as { code?: unknown };
	return candidate.code === 404 || candidate.code === 5;
}

async function waitForGlobalOp(
	auth: Awaited<ReturnType<typeof impersonatedAuth>>,
	project: string,
	operation: string,
) {
	const operations = new GlobalOperationsClient({ auth });
	await operations.wait({ project, operation });
}

// Best-effort cleanup of the probe firewall: swallows a not-found error
// (nothing to clean up) silently, and swallows any other error after
// logging it, so a cleanup failure never masks or replaces the proof's
// own result.
async function bestEffortDeleteProbe({
	firewalls,
	auth,
	project,
	proofLogger,
}: {
	firewalls: FirewallsClient;
	auth: Awaited<ReturnType<typeof impersonatedAuth>>;
	project: string;
	proofLogger: Logger;
}): Promise<void> {
	try {
		const [op] = await firewalls.delete({ project, firewall: PROBE_NAME });
		await waitForGlobalOp(auth, project, op.name as string);
	} catch (err) {
		if (!isNotFound(err)) {
			proofLogger.warn({ err }, "Best-effort probe firewall delete failed.");
		}
	}
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

		// Self-heal a leftover from a previous run before probing.
		await bestEffortDeleteProbe({
			firewalls: hostFirewalls,
			auth: hostAuth,
			project: config.hostProjectId,
			proofLogger,
		});

		try {
			await retryUntilSuccess(async () => {
				const [op] = await hostFirewalls.insert({
					project: config.hostProjectId,
					firewallResource: probeFirewall(config),
				});
				await waitForGlobalOp(
					hostAuth,
					config.hostProjectId,
					op.name as string,
				);
			});
		} finally {
			// Guaranteed cleanup regardless of whether the insert succeeded.
			await bestEffortDeleteProbe({
				firewalls: hostFirewalls,
				auth: hostAuth,
				project: config.hostProjectId,
				proofLogger,
			});
		}

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

		if (!denial.deniedConsistently) {
			// The insert may have unexpectedly succeeded; clean up so a
			// leftover doesn't poison the next run. Harmless no-op (404,
			// silently swallowed) if it never got created.
			await bestEffortDeleteProbe({
				firewalls: serviceFirewalls,
				auth: serviceAuth,
				project: config.hostProjectId,
				proofLogger,
			});
		}

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
