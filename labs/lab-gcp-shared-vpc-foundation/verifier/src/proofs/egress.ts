import type { VerifierConfig } from "../config/config";
import { retryUntilSuccess } from "../lib/retry";
import type { Logger } from "../logger";
import type { ProofResult } from "./result";
import { execOverSsh } from "./ssh";

export async function proveEgressOnlyViaProxy({
	config,
	logger,
}: {
	config: VerifierConfig;
	logger: Logger;
}): Promise<ProofResult[]> {
	const proofLogger = logger.child({ proof: "egress" });
	const results: ProofResult[] = [];
	const ssh = (command: string, timeoutMs: number) =>
		execOverSsh({
			port: config.tunnelPortA,
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

	const checks = [
		{
			expectation:
				"direct internet access from the VM fails (default-deny egress)",
			command: `curl -sS -m 8 -o /dev/null https://${config.allowedDomain}`,
			timeoutMs: 30000,
			passWhen: (code: number) => code !== 0,
		},
		{
			expectation: "the allowlisted domain succeeds through the host's proxy",
			command: `curl -sS -m 20 -o /dev/null -w '%{http_code}' -x ${proxy} https://${config.allowedDomain}`,
			timeoutMs: 40000,
			passWhen: (code: number) => code === 0,
		},
		{
			expectation: "a non-allowlisted domain is denied by the host's proxy",
			command: `curl -sS -m 20 -o /dev/null -x ${proxy} https://${config.deniedDomain}`,
			timeoutMs: 40000,
			passWhen: (code: number) => code !== 0,
		},
	];

	for (const check of checks) {
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
				detail: `exit=${code} stdout=${stdout.slice(0, 200)} stderr=${stderr.slice(0, 200)}`,
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
				detail: String(err),
			});
		}
	}
	return results;
}
