import { expect, it } from "vitest";
import { createScriptedProvider } from "./scripted.js";

it("extracts short relevant evidence rather than copying the entire source", async () => {
	const source = {
		id: "doc",
		filename: "handbook.md",
		ordinal: 0,
		text: "The amber valve recovery code is ORCHID-47. Unrelated notes. The violet pump is quiet.",
	};
	const events: unknown[] = [];
	const run = (query: string) =>
		createScriptedProvider().run({
			history: [],
			query,
			signal: new AbortController().signal,
			retrieve: async () => ({ sources: [source], context: source.text }),
			emit: (event) => events.push(event),
		});
	const answer = await run("What is the amber valve recovery code?");
	expect(answer.answer).toBe(
		"The amber valve recovery code is ORCHID-47. [handbook.md#0]",
	);
	expect(events[0]).toEqual({ type: "sources", sources: [source] });
	expect(await run("purple penguin population")).toMatchObject({
		answer: "I cannot answer from the available documents.",
	});
});
