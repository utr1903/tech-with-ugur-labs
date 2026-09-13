import assert from "node:assert/strict";
import {
	chat,
	configure,
	newThread,
	request,
	turn,
} from "../lib/application.js";
import { json, save } from "../lib/commands.js";
import type { Assertion } from "./report.js";
export async function graph(): Promise<Assertion[]> {
	const assertions: Assertion[] = [];
	for (const [scenario, source, expected] of [
		["tool", "print(6*7)", "succeeded"],
		["conversation", "print(6*7)", "none"],
		[
			"tool",
			"import sys;print('EXECUTED');print('stderr-marker',file=sys.stderr);sys.exit(7)",
			"failed",
		],
		["tool", "import sys;print('EXECUTED');sys.exit(124)", "failed"],
		["tool", "import sys;print('EXECUTED');sys.exit(137)", "failed"],
		["repeat", "print(6*7)", "cap"],
	]) {
		assert(scenario && source && expected);
		await configure(scenario, source);
		const thread = await newThread();
		const body = turn();
		const result = await chat(thread, body);
		const tools = result.events.filter((e) => e.type === "tool-result");
		if (expected === "none") assert.equal(tools.length, 0);
		else if (expected === "cap") assert.equal(tools.length, 2);
		else {
			assert.equal(tools.length, 1);
			assert.equal(tools[0].result.status, expected);
			assert(
				tools[0].result.stdout.includes(
					source === "print(6*7)" ? "42" : "EXECUTED",
				),
			);
		}
		assert.equal(
			result.events.at(-1).type,
			expected === "cap" ? "error" : "done",
		);
		const replay = await chat(thread, body);
		assert.equal(replay.text, result.text);
		const history = await (await request(`/threads/${thread}/messages`)).json();
		assert.equal(history.activeTurn, null);
		const jobs = json<{ items: unknown[] }>(["get", "jobs", "-n", "executor"]);
		assert.equal(jobs.items.length, 0);
		assertions.push({
			name: `graph-${expected}-${body.turnId}`,
			layer: "real Hono/LangGraph/Postgres/gVisor",
			attempted: `${scenario} tool status, durable replay, cleanup`,
			status: "passed",
			evidence: { thread, events: `${body.turnId}-events.json` },
		});
	}
	save("graph.json", assertions);
	return assertions;
}
