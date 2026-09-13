import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { command, context, kubeconfig, save } from "./commands.js";
export function watchJobs() {
	const child = spawn(
		command("which", ["kubectl"]).trim(),
		[
			"--kubeconfig",
			kubeconfig,
			"--context",
			context,
			"get",
			"jobs",
			"-n",
			"executor",
			"--watch",
			"-o",
			"custom-columns=NAME:.metadata.name,UID:.metadata.uid",
			"--no-headers",
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let output = "";
	child.stdout.on("data", (data) => {
		output += String(data);
		if (output.length > 65536) child.kill();
	});
	return {
		stop: () => child.kill(),
		assertSingle: (name: string, uid: string) => {
			assert.equal(
				child.exitCode,
				null,
				"Independent Job watch exited during drill.",
			);
			assert(output.length <= 65536, "Job watch overflow.");
			const identities = [
				...new Set(
					output
						.trim()
						.split("\n")
						.filter(Boolean)
						.map((line) => line.trim().split(/\s+/).join(" ")),
				),
			];
			save("browser-job-watch.json", { identities, name, uid });
			assert.deepEqual(identities, [`${name} ${uid}`]);
		},
	};
}
