import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
	chat,
	configure,
	newThread,
	startForward,
	turn,
} from "../lib/application.js";
import { save } from "../lib/commands.js";
import { crashBackend } from "../lib/crash-backend.js";
import type { Assertion } from "./report.js";
export async function context(): Promise<Assertion[]> {
	await configure("context");
	const thread = await newThread();
	const token = randomUUID();
	await chat(thread, turn(`Remember token ${token}.`));
	await crashBackend("context");
	await startForward();
	const followup = turn("What token did I ask you to remember?");
	assert(!JSON.stringify(followup).includes(token));
	const recalled = await chat(thread, followup);
	const separate = await newThread();
	const isolated = await chat(
		separate,
		turn("What token did I ask you to remember?"),
	);
	const assistant = (result: Awaited<ReturnType<typeof chat>>) =>
		result.events
			.filter((event) => event.type === "assistant")
			.map((event) => event.text)
			.join("");
	assert.equal(assistant(recalled), `Remembered token: ${token}`);
	assert.equal(assistant(isolated), "Remembered token: none");
	assert.equal(recalled.events.at(-1).type, "done");
	assert.equal(isolated.events.at(-1).type, "done");
	save("context.json", {
		thread,
		separate,
		token,
		followup,
		recalled: recalled.events,
		isolated: isolated.events,
	});
	return [
		{
			name: "model-context-after-process-restart",
			layer: "real graph/PostgreSQL/model adapter",
			attempted:
				"recall prior model input after stopped backend; separate thread negative",
			status: "passed",
			evidence: ["context.json", "context-backend-crash-proof.json"],
		},
	];
}
