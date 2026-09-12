import { json, kube, pause, save } from "./commands.js";
import type { Pod } from "./jobs.js";
export async function executedMarker() {
	let budget = 32768;
	for (let n = 0; n < 60 && budget > 0; n++) {
		const pod = json<{ items: Pod[] }>(["get", "pods", "-n", "executor"])
			.items[0];
		if (pod?.status?.containerStatuses?.[0]?.state.running) {
			const logs = kube([
				"logs",
				pod.metadata.name,
				"-n",
				"executor",
				`--limit-bytes=${Math.min(4096, budget)}`,
			]);
			budget -= Buffer.byteLength(logs);
			const chunks = logs
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line))
				.filter(
					(frame) => frame.captureVersion === 1 && frame.stream === "stdout",
				)
				.map((frame) => Buffer.from(frame.dataB64, "base64").toString());
			if (chunks.join("").includes("EXECUTED")) {
				save("browser-running-pod.json", { pod, logs });
				return;
			}
		}
		await pause(100);
	}
	throw new Error(
		"Browser crash drill requires independently observed running Pod and executed source marker.",
	);
}
