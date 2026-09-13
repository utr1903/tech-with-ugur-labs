import assert from "node:assert/strict";
import {
	configure,
	newThread,
	request,
	startForward,
	turn,
} from "../lib/application.js";
import { json, kube, pause, save } from "../lib/commands.js";
import type { Assertion } from "./report.js";

const base = "http://127.0.0.1:3001";
function open(id: string) {
	return fetch(`${base}/threads/${id}/chat`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(turn()),
		signal: AbortSignal.timeout(45000),
	});
}
async function active(id: string) {
	for (let n = 0; n < 40; n++) {
		const h = await (await request(`/threads/${id}/messages`)).json();
		if (h.activeTurn) return;
		await pause(100);
	}
	throw new Error("Stalled turn did not acquire a live slot.");
}
async function jobs(expected: number) {
	for (let n = 0; n < 60; n++) {
		const value = json<{ items: unknown[] }>(["get", "jobs", "-n", "executor"]);
		assert(value.items.length <= 2);
		if (value.items.length === expected) return value;
		await pause(100);
	}
	throw new Error("Expected active execution slots were not established.");
}
export async function concurrency(): Promise<Assertion[]> {
	await configure("stall");
	const threads = await Promise.all(
		Array.from({ length: 5 }, () => newThread()),
	);
	const pending: Promise<string>[] = [];
	for (const id of threads.slice(0, 4)) {
		pending.push(
			open(id)
				.then((r) => r.text())
				.catch(() => "disconnected during deliberate restart"),
		);
		await active(id);
	}
	const fifth = threads[4];
	const first = threads[0];
	assert(fifth && first);
	const overload = await open(fifth);
	assert.equal(overload.status, 409);
	const sameThread = await open(first);
	assert.equal(sameThread.status, 409);
	kube(["rollout", "restart", "deployment/chat-backend", "-n", "executor-app"]);
	kube([
		"rollout",
		"status",
		"deployment/chat-backend",
		"-n",
		"executor-app",
		"--timeout=120s",
	]);
	await startForward();
	await configure(
		"tool",
		"import time;print('EXECUTED',flush=True);time.sleep(7)",
	);
	await Promise.all(pending);
	// Recovery completes the old model-only turns under the restored scripted mode.
	for (let n = 0; n < 120; n++) {
		const histories = await Promise.all(
			threads
				.slice(0, 4)
				.map(
					async (id) =>
						(await (await request(`/threads/${id}/messages`)).json())
							.activeTurn,
				),
		);
		if (histories.every((v) => v === null)) break;
		await pause(250);
	}
	await jobs(0);
	const one = await newThread();
	const firstRun = open(one).then((r) => r.text());
	await jobs(1);
	const two = await newThread();
	const secondRun = open(two).then((r) => r.text());
	const concurrent = await jobs(2);
	const third = await newThread();
	const rejected = await (await open(third)).text();
	assert(rejected.includes('"status":"rejected"'));
	const streams = await Promise.all([firstRun, secondRun]);
	assert(streams.every((s) => s.includes('"status":"succeeded"')));
	await jobs(0);
	save("concurrency.json", {
		overload: overload.status,
		sameThread: sameThread.status,
		concurrent,
		streams,
		rejected,
	});
	return [
		{
			name: "global-turn-job-caps",
			layer: "durable PostgreSQL leases and executor",
			attempted:
				"four acknowledged active turns plus fifth; same-thread contention; two live Jobs plus third execution",
			status: "passed",
			evidence: "concurrency.json",
		},
	];
}
