import { expect, test, vi } from "vitest";
import { createProtocol } from "./protocol";

test("completed allowed function emits question; duplicates remain correlated by controller", () => {
	const send = vi.fn();
	const call = vi.fn();
	const fail = vi.fn();
	const p = createProtocol(send, call, fail);
	p.event({
		type: "response.function_call_arguments.done",
		name: "ask_knowledge_base",
		call_id: "abc",
		arguments: '{"question":"amber?"}',
	});
	expect(call).toHaveBeenCalledWith({ id: "abc", question: "amber?" });
	expect(fail).not.toHaveBeenCalled();
});
test("delivery disables recursive tools and restores forced question tool", () => {
	const send = vi.fn();
	const p = createProtocol(
		send,
		() => {},
		() => {},
	);
	p.output("abc", { answer: "canary", sources: [] });
	expect(send).toHaveBeenNthCalledWith(1, {
		type: "conversation.item.create",
		item: {
			type: "function_call_output",
			call_id: "abc",
			output: '{"answer":"canary","sources":[]}',
		},
	});
	expect(send.mock.calls[1]?.[0]).toMatchObject({
		type: "response.create",
		response: { tool_choice: "none" },
	});
	p.event({ type: "response.done" });
	expect(send.mock.calls.at(-1)?.[0]).toMatchObject({
		type: "session.update",
		session: { tool_choice: { type: "function", name: "ask_knowledge_base" } },
	});
});
test("unknown function or malformed arguments produces safe failure", () => {
	const fail = vi.fn();
	const p = createProtocol(
		() => {},
		() => {},
		fail,
	);
	p.event({
		type: "response.function_call_arguments.done",
		name: "other",
		call_id: "x",
		arguments: "{}",
	});
	p.event({
		type: "response.function_call_arguments.done",
		name: "ask_knowledge_base",
		call_id: "x",
		arguments: "broken",
	});
	expect(fail).toHaveBeenCalledTimes(2);
});
test("speech delivery waits for the active question response to finish", () => {
	const send = vi.fn();
	const p = createProtocol(
		send,
		() => {},
		() => {},
	);
	p.event({ type: "response.created" });
	p.output("abc", { answer: "canary", sources: [] });
	expect(
		send.mock.calls.filter(([e]) => e.type === "response.create"),
	).toHaveLength(0);
	p.event({ type: "response.done" });
	expect(
		send.mock.calls.filter(([e]) => e.type === "response.create"),
	).toHaveLength(1);
});
test("multiple tool results serialize their spoken delivery responses", () => {
	const send = vi.fn();
	const p = createProtocol(
		send,
		() => {},
		() => {},
	);
	p.output("abc", { answer: "first", sources: [] });
	p.output("def", { answer: "second", sources: [] });
	expect(
		send.mock.calls.filter(([e]) => e.type === "response.create"),
	).toHaveLength(1);
	p.event({ type: "response.done" });
	expect(
		send.mock.calls.filter(([e]) => e.type === "response.create"),
	).toHaveLength(2);
});
