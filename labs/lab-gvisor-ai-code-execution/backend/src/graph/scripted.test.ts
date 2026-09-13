import { HumanMessage } from "@langchain/core/messages";
import { expect, it } from "vitest";
import { ScriptedModel } from "./scripted.js";

it("computes recall only from prior model input messages, with no instance memory", async () => {
	const signal = new AbortController().signal;
	const remembered = new HumanMessage("Remember token 51c87462-a57e.");
	const followup = new HumanMessage("What token did I ask you to remember?");
	const model = new ScriptedModel("context");
	expect((await model.invoke([remembered, followup], signal)).content).toBe(
		"Remembered token: 51c87462-a57e",
	);
	expect((await model.invoke([followup], signal)).content).toBe(
		"Remembered token: none",
	);
	expect((await model.invoke([remembered], signal)).content).toBe(
		"Remembered token: none",
	);
});
