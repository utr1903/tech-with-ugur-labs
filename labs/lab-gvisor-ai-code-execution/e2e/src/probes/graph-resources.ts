import assert from "node:assert/strict";
import { chat, configure, newThread, turn } from "../lib/application.js";
import { save } from "../lib/commands.js";
import type { Assertion } from "./report.js";
export async function graphResources(): Promise<Assertion[]> {
	const results: Assertion[] = [];
	for (const [status, source] of [
		[
			"timeout",
			"import os,signal,time;print('EXECUTED',flush=True);time.sleep(.3);os.kill(os.getppid(),signal.SIGSTOP);time.sleep(60)",
		],
		[
			"oom",
			"import time;print('EXECUTED',flush=True);time.sleep(.3)\na=[]\nwhile True:a.append(bytearray(1024*1024))",
		],
	]) {
		assert(status && source);
		await configure("tool", source);
		const thread = await newThread();
		const body = turn();
		const response = await chat(thread, body);
		const tools = response.events.filter((e) => e.type === "tool-result");
		assert.equal(tools.length, 1);
		assert.equal(tools[0].result.status, status);
		assert(tools[0].result.stdout.includes("EXECUTED"));
		assert.equal(response.events.at(-1).type, "done");
		results.push({
			name: `graph-${status}`,
			layer:
				"real graph and independently enforced backend/Kubernetes termination",
			attempted: status,
			status: "passed",
			evidence: { thread, file: `${body.turnId}-events.json` },
		});
	}
	save("graph-resources.json", results);
	return results;
}
