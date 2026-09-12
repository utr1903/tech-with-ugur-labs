import { expect, test, vi } from "vitest";
import { createController } from "./controller";
import type { Answer, Call, State, Token, Transport } from "./transport";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (err: Error) => void;
	const promise = new Promise<T>((a, b) => {
		resolve = a;
		reject = b;
	});
	return { promise, resolve, reject };
}
function setup() {
	const states: State[] = [];
	const transports: Transport[] = [];
	const calls: ((call: Call) => void)[] = [];
	const token: Token = { mode: "scripted", conversationId: "fresh" };
	const relay = vi.fn(
		async (): Promise<Answer> => ({ answer: "canary", sources: [] }),
	);
	const fetchToken = vi.fn(async () => token);
	const factory = () => {
		const transport = {
			start: vi.fn(async (_token: Token, call: (call: Call) => void) => {
				calls.push(call);
			}),
			dispose: vi.fn(),
			output: vi.fn(),
			question: vi.fn(),
		};
		transports.push(transport);
		return transport;
	};
	const controller = createController({
		token: fetchToken,
		relay,
		transport: factory,
		change: (s) => states.push(s),
	});
	return { controller, states, transports, calls, relay, fetchToken, factory };
}
test("repeated Start disposes first transport; Stop disposes active transport", async () => {
	const s = setup();
	await s.controller.start();
	await s.controller.start();
	expect(s.transports).toHaveLength(2);
	expect(s.transports[0]?.dispose).toHaveBeenCalledOnce();
	s.controller.stop();
	expect(s.transports[1]?.dispose).toHaveBeenCalledOnce();
	expect(s.states.at(-1)?.status).toBe("Stopped");
});
test("Stop ignores a late token without allocating transport", async () => {
	const s = setup();
	const d = deferred<Token>();
	s.fetchToken.mockReturnValue(d.promise);
	const pending = s.controller.start();
	s.controller.stop();
	d.resolve({ mode: "scripted", conversationId: "late" });
	await pending;
	expect(s.transports).toHaveLength(0);
	expect(s.states.at(-1)?.status).toBe("Stopped");
});
test("late answer after Stop cannot render or send output", async () => {
	const s = setup();
	const d = deferred<Answer>();
	s.relay.mockReturnValue(d.promise);
	await s.controller.start();
	s.calls[0]?.({ id: "a", question: "q" });
	s.controller.stop();
	d.resolve({ answer: "stale", sources: [] });
	await vi.waitFor(() => expect(s.relay).toHaveBeenCalledOnce());
	await Promise.resolve();
	expect(s.states.some((x) => x.answer)).toBe(false);
	expect(s.transports[0]?.output).not.toHaveBeenCalled();
});
test("duplicate call IDs relay once and correlate output", async () => {
	const s = setup();
	await s.controller.start();
	s.calls[0]?.({ id: "call-7", question: "q" });
	s.calls[0]?.({ id: "call-7", question: "q" });
	await vi.waitFor(() =>
		expect(s.transports[0]?.output).toHaveBeenCalledWith("call-7", {
			answer: "canary",
			sources: [],
		}),
	);
	expect(s.relay).toHaveBeenCalledOnce();
});
test("failed relay disposes the session and requires a new Start", async () => {
	const s = setup();
	s.relay.mockRejectedValueOnce(new Error("secret"));
	await s.controller.start();
	s.calls[0]?.({ id: "fail", question: "q" });
	await vi.waitFor(() => expect(s.states.at(-1)?.status).toBe("Error"));
	expect(s.states.at(-1)?.error).toContain("Start again");
	expect(s.states.at(-1)?.error).not.toContain("secret");
	expect(s.transports[0]?.dispose).toHaveBeenCalledOnce();
	expect(s.transports[0]?.output).not.toHaveBeenCalled();
	s.calls[0]?.({ id: "stale", question: "q" });
	expect(s.relay).toHaveBeenCalledOnce();
	await s.controller.start();
	s.calls[1]?.({ id: "next", question: "q" });
	await vi.waitFor(() =>
		expect(s.states.at(-1)?.answer?.answer).toBe("canary"),
	);
});
test("failed token renders usable safe error", async () => {
	const s = setup();
	s.fetchToken.mockRejectedValue(new Error("secret"));
	await s.controller.start();
	expect(s.states.at(-1)?.error).toBe(
		"Connection failed. Check the services and microphone permission, then Start again.",
	);
});
test("failed transport start disposes partial resources", async () => {
	const s = setup();
	const t = s.factory();
	t.start = vi.fn(async () => {
		throw Error("secret");
	});
	const states: State[] = [];
	const c = createController({
		token: s.fetchToken,
		relay: s.relay,
		transport: () => t,
		change: (x) => states.push(x),
	});
	await c.start();
	expect(t.dispose).toHaveBeenCalledOnce();
	expect(states.at(-1)?.error).toBeTruthy();
});
test("Stop during connection suppresses late success and failure", async () => {
	const s = setup();
	const d = deferred<void>();
	void d.promise.catch(() => {});
	const t = s.factory();
	t.start = vi.fn(() => d.promise);
	const states: State[] = [];
	const c = createController({
		token: s.fetchToken,
		relay: s.relay,
		transport: () => t,
		change: (x) => states.push(x),
	});
	const p = c.start();
	await Promise.resolve();
	c.stop();
	d.reject(Error("late"));
	await p;
	expect(t.dispose).toHaveBeenCalled();
	expect(states.at(-1)?.status).toBe("Stopped");
});

test("a late relay failure cannot dispose a fresh session", async () => {
	const s = setup();
	const d = deferred<Answer>();
	s.relay.mockReturnValueOnce(d.promise);
	await s.controller.start();
	s.calls[0]?.({ id: "old", question: "q" });
	await s.controller.start();
	d.reject(Error("late failure"));
	await Promise.resolve();
	await Promise.resolve();
	expect(s.states.at(-1)?.status).toBe("Ready");
	expect(s.transports[1]?.dispose).not.toHaveBeenCalled();
	s.calls[1]?.({ id: "fresh", question: "q" });
	await vi.waitFor(() =>
		expect(s.states.at(-1)?.answer?.answer).toBe("canary"),
	);
});
