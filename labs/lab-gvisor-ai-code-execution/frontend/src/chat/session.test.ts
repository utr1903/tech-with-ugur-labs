import { expect, it, vi } from "vitest";
import { createTurn, loadPending, savePending } from "./session";

it("sends full user history with stable request and cursor persisted for refresh", () => {
	const store = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		setItem: (k: string, v: string) => store.set(k, v),
		getItem: (k: string) => store.get(k),
	});
	const turn = createTurn(
		[
			{ id: "old", role: "user", text: "first" },
			{ id: "reply", role: "assistant", text: "answer" },
		],
		"second",
	);
	const pending = { request: turn.request, cursor: 17 };
	savePending("thread", pending);
	expect(loadPending("thread")).toEqual(pending);
	expect(turn.request.messages).toEqual([
		{ id: "old", role: "user", text: "first" },
		turn.message,
	]);
	vi.unstubAllGlobals();
});
