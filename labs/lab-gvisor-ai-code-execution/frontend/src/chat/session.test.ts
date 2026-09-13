import { expect, it, vi } from "vitest";
import { createTurn, loadPending, savePending } from "./session";

it("sends only the new user message with stable request and cursor persisted for refresh", async () => {
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
	vi.resetModules();
	expect((await import("./session")).loadPending("thread")).toEqual(pending);
	expect(turn.request.messages).toEqual([turn.message]);
	vi.unstubAllGlobals();
});

it("rejects oversized UTF-8 input before creating pending work", () => {
	expect(() => createTurn([], "a".repeat(16385))).toThrow("16 KiB");
	expect(() => createTurn([], "é".repeat(8193))).toThrow("16 KiB");
	expect(createTurn([], "é".repeat(8192)).request.messages).toHaveLength(1);
});
it("rejects corrupt pending identities and cursors", () => {
	vi.stubGlobal("localStorage", {
		getItem: () =>
			JSON.stringify({ request: { turnId: "t", messages: [] }, cursor: -1 }),
	});
	expect(() => loadPending("corrupt")).toThrow("Saved request");
	vi.unstubAllGlobals();
});
it("retains exact pending work in memory when browser storage is unavailable", () => {
	vi.stubGlobal("localStorage", {
		getItem: () => {
			throw new Error("Unavailable");
		},
		setItem: () => {
			throw new Error("Quota");
		},
		removeItem: () => {
			throw new Error("Unavailable");
		},
	});
	const pending = { request: createTurn([], "hello").request, cursor: 3 };
	expect(savePending("unavailable", pending)).toBe(false);
	expect(loadPending("unavailable")).toEqual(pending);
	vi.unstubAllGlobals();
});
it("rejects malformed JSON and unsafe saved cursor without inventing a turn", () => {
	for (const raw of [
		"{broken",
		JSON.stringify({
			request: {
				turnId: "t",
				messages: [{ id: "u", role: "user", text: "hello" }],
			},
			cursor: 1.5,
		}),
	]) {
		vi.stubGlobal("localStorage", { getItem: () => raw });
		expect(() => loadPending("invalid-json")).toThrow("Saved request");
	}
	vi.unstubAllGlobals();
});
