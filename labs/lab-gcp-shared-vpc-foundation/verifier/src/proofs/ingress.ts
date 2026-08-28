import type { VerifierConfig } from "../config/config";
import { retryUntilSuccess } from "../lib/retry";
import type { Logger } from "../logger";
import type { ProofResult } from "./result";

const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchStatus(
	url: string,
): Promise<{ status: number; body: string }> {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(10000),
		redirect: "manual",
	});
	return { status: response.status, body: await response.text() };
}

export async function proveIngressDenied({
	config,
	logger,
}: {
	config: VerifierConfig;
	logger: Logger;
}): Promise<ProofResult> {
	const proofLogger = logger.child({ proof: "ingress-denied" });
	const url = `http://${config.lbIp}/a`;
	const expectation =
		"load balancer answers 403 from Cloud Armor while the allowlist is empty";

	try {
		proofLogger.info({ url }, "Proving ingress denial...");
		// Ride out LB provisioning: wait until the edge answers 403 at all...
		await retryUntilSuccess(
			async () => {
				const { status } = await fetchStatus(url);
				if (status !== 403) throw new Error(`expected 403, got ${status}`);
			},
			{ attempts: 30, initialDelayMs: 10000, factor: 1.2 },
		);
		// ...then require it to be stable.
		for (let sample = 0; sample < 3; sample += 1) {
			const { status } = await fetchStatus(url);
			if (status !== 403) {
				proofLogger.info({ status }, "Proving ingress denial finished.");
				return {
					proof: "ingress-denied",
					expectation,
					passed: false,
					detail: `unstable: got ${status} on confirmation sample`,
				};
			}
			if (sample < 2) await sleep(10000);
		}
		proofLogger.info({}, "Proving ingress denial succeeded.");
		return {
			proof: "ingress-denied",
			expectation,
			passed: true,
			detail: "403 on all confirmation samples",
		};
	} catch (err) {
		proofLogger.error({ err }, "Proving ingress denial failed.");
		return {
			proof: "ingress-denied",
			expectation,
			passed: false,
			detail: String(err),
		};
	}
}

export async function proveIngressAllowed({
	config,
	logger,
}: {
	config: VerifierConfig;
	logger: Logger;
}): Promise<ProofResult[]> {
	const proofLogger = logger.child({ proof: "ingress-allowed" });
	const targets = [
		{ path: "/a", marker: "vm-service-a" },
		{ path: "/b", marker: "vm-service-b" },
	];
	const results: ProofResult[] = [];

	for (const target of targets) {
		const url = `http://${config.lbIp}${target.path}`;
		const expectation = `load balancer serves ${target.marker} at ${target.path} once the runner is allowlisted`;
		try {
			proofLogger.info({ url }, "Proving allowed ingress...");
			await retryUntilSuccess(
				async () => {
					const { status, body } = await fetchStatus(url);
					if (status !== 200) throw new Error(`expected 200, got ${status}`);
					if (!body.includes(target.marker)) {
						throw new Error(`body does not identify ${target.marker}`);
					}
				},
				{ attempts: 30, initialDelayMs: 10000, factor: 1.2 },
			);
			proofLogger.info({ url }, "Proving allowed ingress succeeded.");
			results.push({
				proof: "ingress-allowed",
				expectation,
				passed: true,
				detail: `200 with ${target.marker}`,
			});
		} catch (err) {
			proofLogger.error({ err, url }, "Proving allowed ingress failed.");
			results.push({
				proof: "ingress-allowed",
				expectation,
				passed: false,
				detail: String(err),
			});
		}
	}
	return results;
}
