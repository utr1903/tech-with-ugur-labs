import assert from "node:assert/strict";
import { chat, configure, newThread, turn } from "../lib/application.js";
import { json, pause, save } from "../lib/commands.js";
import type { Pod } from "../lib/jobs.js";
import { verifyCanaries } from "./filesystem-evidence.js";
import { canaryFixtures } from "./filesystem-fixtures.js";
import { canarySource } from "./filesystem-source.js";
import type { Assertion } from "./report.js";
export async function filesystem(): Promise<Assertion[]> {
	const fixture = canaryFixtures();
	const databaseIP = json<{ spec: { clusterIP: string } }>([
		"get",
		"service",
		"chat-postgres",
		"-n",
		"executor-app",
	]).spec.clusterIP;
	const source = canarySource(fixture, databaseIP);
	for (const value of Object.values(fixture.values))
		assert(!source.includes(value));
	try {
		await configure("tool", source);
		fixture.seed();
		const before = fixture.read();
		save("filesystem-canary-before.json", {
			fixture: {
				path: fixture.path,
				hostPath: fixture.hostPath,
				secret: fixture.secret,
				table: fixture.table,
				pod: fixture.pod,
			},
			before,
		});
		const id = await newThread();
		const body = turn("Run the supplied bounded fake-data containment probe.");
		const running = chat(id, body);
		let pod: Pod | undefined;
		for (let n = 0; n < 80; n++) {
			pod = json<{ items: Pod[] }>(["get", "pods", "-n", "executor"]).items[0];
			if (pod) break;
			await pause(100);
		}
		const result = await running;
		assert(pod, "No independently observed graph execution Pod.");
		const tools = result.events.filter((e) => e.type === "tool-result");
		assert.equal(tools.length, 1);
		assert.equal(tools[0].result.status, "succeeded");
		for (const flag of [
			"stdoutTruncated",
			"stderrTruncated",
			"runnerReportedTruncation",
		])
			assert.equal(
				tools[0].result[flag],
				false,
				"Canary capture must be complete.",
			);
		assert(
			pod.metadata.name.startsWith(`exec-${tools[0].result.executionId}-`),
			"Observed Pod does not belong to graph execution.",
		);
		const output: string = tools[0].result.stdout + tools[0].result.stderr;
		const sensitive = output
			.split("\n")
			.find((line) => line.startsWith('{"sensitive_paths_present"'));
		assert(sensitive);
		assert(
			Object.values(JSON.parse(sensitive).sensitive_paths_present).every(
				(v) => v === false,
			),
		);
		const after = fixture.read();
		const boundaries = verifyCanaries(fixture.values, before, after, output);
		save("filesystem-pod.json", pod);
		save("filesystem-canaries.json", {
			boundaries,
			thread: id,
			turn: body.turnId,
			source,
			output,
			pod: pod.metadata,
		});
		return [
			{
				name: "filesystem-canaries",
				layer: "real graph/gVisor/Pod mounts and network isolation",
				attempted:
					"bounded reads of exact fake app/database/Secret/host canaries; independent positive reads and unchanged/absent-output checks",
				status: "passed",
				evidence: {
					boundaries: "filesystem-canaries.json",
					pod: "filesystem-pod.json",
					events: `${body.turnId}-events.json`,
				},
			},
		];
	} finally {
		try {
			fixture.cleanup();
			save("filesystem-cleanup.json", { exactOwnedFixturesRemoved: true });
		} finally {
			await configure("tool");
		}
	}
}
