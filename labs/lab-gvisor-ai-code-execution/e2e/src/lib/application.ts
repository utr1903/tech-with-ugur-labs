import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { command, context, kube, kubeconfig, pause, save } from "./commands.js";

const backend = "http://127.0.0.1:3001";
export const frontend = "http://127.0.0.1:3000";
let forward: ChildProcess | undefined;
export function stopForward() {
	forward?.kill();
	forward = undefined;
}
export async function startForward() {
	stopForward();
	forward = spawn(
		command("which", ["kubectl"]).trim(),
		[
			"--kubeconfig",
			kubeconfig,
			"--context",
			context,
			"-n",
			"executor-app",
			"port-forward",
			"--address=127.0.0.1",
			"service/chat-backend",
			"3001:3001",
		],
		{ stdio: "ignore" },
	);
	for (let n = 0; n < 40; n++) {
		try {
			if ((await fetch(`${backend}/health`)).ok) return;
		} catch {}
		await pause(250);
	}
	throw new Error("Owned backend localhost forward unavailable.");
}
export async function configure(scenario: string, source = "print(6*7)") {
	kube([
		"set",
		"env",
		"deployment/chat-backend",
		"-n",
		"executor-app",
		`MODEL_MODE=scripted`,
		`SCRIPTED_SCENARIO=${scenario}`,
		`SCRIPTED_SOURCE=${source}`,
	]);
	kube([
		"rollout",
		"status",
		"deployment/chat-backend",
		"-n",
		"executor-app",
		"--timeout=120s",
	]);
	await startForward();
}
export async function request(path: string, body?: unknown) {
	const result = await fetch(`${backend}${path}`, {
		method: body ? "POST" : "GET",
		headers: { "content-type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(310000),
	});
	assert(result.ok, `Application HTTP ${result.status}`);
	return result;
}
export async function newThread(): Promise<string> {
	return (await (await request("/threads", {})).json()).id;
}
export function turn(text = "Calculate 6 times 7 using Python") {
	return {
		turnId: randomUUID(),
		messages: [{ id: randomUUID(), role: "user", text }],
	};
}
export async function chat(id: string, body: ReturnType<typeof turn>) {
	const text = await (await request(`/threads/${id}/chat`, body)).text();
	assert(Buffer.byteLength(text) < 262144);
	const events = text
		.split("\n")
		.filter((l) => l.startsWith("data: "))
		.map((l) => JSON.parse(l.slice(6)));
	save(`${body.turnId}-events.json`, events);
	return { text, events };
}
