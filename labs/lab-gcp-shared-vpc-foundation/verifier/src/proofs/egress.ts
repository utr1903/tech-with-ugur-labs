import type { VerifierConfig } from "../config/config";
import { retryUntilSuccess } from "../lib/retry";
import type { Logger } from "../logger";
import type { ProofResult } from "./result";
import { execOverSsh } from "./ssh";

type EgressCheck = {
	expectation: string;
	command: string;
	timeoutMs: number;
	passWhen: (code: number) => boolean;
};

function buildChecks(
	config: VerifierConfig,
	proxy: string,
	vmLabel: string,
): EgressCheck[] {
	return [
		{
			expectation: `direct internet access from ${vmLabel} fails (default-deny egress)`,
			command: `curl -sS -m 8 -o /dev/null https://${config.allowedDomain}`,
			timeoutMs: 30000,
			passWhen: (code) => code !== 0,
		},
		{
			expectation: `the allowlisted domain succeeds through the host's proxy from ${vmLabel}`,
			command: `curl -sS -m 20 -o /dev/null -w '%{http_code}' -x ${proxy} https://${config.allowedDomain}`,
			timeoutMs: 40000,
			passWhen: (code) => code === 0,
		},
		{
			expectation: `a non-allowlisted domain is denied by the host's proxy from ${vmLabel}`,
			command: `curl -sS -m 20 -o /dev/null -x ${proxy} https://${config.deniedDomain}`,
			timeoutMs: 40000,
			passWhen: (code) => code !== 0,
		},
	];
}

async function proveEgressOnVm({
	config,
	logger,
	tunnelPort,
	vmLabel,
}: {
	config: VerifierConfig;
	logger: Logger;
	tunnelPort: number;
	vmLabel: string;
}): Promise<ProofResult[]> {
	const proofLogger = logger.child({ proof: "egress", vm: vmLabel });
	const results: ProofResult[] = [];
	const ssh = (command: string, timeoutMs: number) =>
		execOverSsh({
			port: tunnelPort,
			privateKeyPath: config.sshKeyPath,
			command,
			timeoutMs,
		});
	const proxy = `http://${config.swpIp}:443`;

	// The tunnel and VM may need a moment; prove connectivity first.
	await retryUntilSuccess(async () => {
		const { code } = await ssh("true", 20000);
		if (code !== 0) throw new Error(`ssh probe exited ${code}`);
	});

	for (const check of buildChecks(config, proxy, vmLabel)) {
		try {
			proofLogger.info({ command: check.command }, "Proving egress rule...");
			const { code, stdout, stderr } = await ssh(
				check.command,
				check.timeoutMs,
			);
			const passed = check.passWhen(code);
			proofLogger.info({ code, passed }, "Proving egress rule finished.");
			results.push({
				proof: "egress",
				expectation: check.expectation,
				passed,
				detail: `vm=${vmLabel} exit=${code} stdout=${stdout.slice(0, 200)} stderr=${stderr.slice(0, 200)}`,
			});
		} catch (err) {
			proofLogger.error(
				{ err, command: check.command },
				"Proving egress rule failed.",
			);
			results.push({
				proof: "egress",
				expectation: check.expectation,
				passed: false,
				detail: `vm=${vmLabel} ${String(err)}`,
			});
		}
	}
	return results;
}

export async function proveEgressOnlyViaProxy({
	config,
	logger,
}: {
	config: VerifierConfig;
	logger: Logger;
}): Promise<ProofResult[]> {
	const vms = [
		{ tunnelPort: config.tunnelPortA, vmLabel: "vm-service-a" },
		{ tunnelPort: config.tunnelPortB, vmLabel: "vm-service-b" },
	];
	const results: ProofResult[] = [];
	for (const vm of vms) {
		results.push(
			...(await proveEgressOnVm({
				config,
				logger,
				tunnelPort: vm.tunnelPort,
				vmLabel: vm.vmLabel,
			})),
		);
	}
	return results;
}
