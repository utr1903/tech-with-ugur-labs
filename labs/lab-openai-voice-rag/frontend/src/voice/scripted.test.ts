import { expect, test, vi } from "vitest";
import { createScripted } from "./scripted";

const token = { mode: "scripted" as const };
test("Stop during microphone acquisition releases a late stream", async () => {
	let resolve!: (s: MediaStream) => void;
	const stop = vi.fn();
	const acquire = () =>
		new Promise<MediaStream>((r) => {
			resolve = r;
		});
	const t = createScripted(acquire);
	const pending = t.start(
		token,
		() => {},
		() => {},
		() => {},
	);
	t.dispose();
	expect(resolve).toBeTypeOf("function");
	resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
	await pending;
	expect(stop).toHaveBeenCalledOnce();
});
test("simulated question emits exact typed query; disposal releases microphone", async () => {
	const stop = vi.fn();
	const call = vi.fn();
	const t = createScripted(
		async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream,
	);
	await t.start(
		token,
		call,
		() => {},
		() => {},
	);
	t.question("canary?");
	expect(call).toHaveBeenCalledWith({
		id: expect.any(String),
		question: "canary?",
	});
	t.dispose();
	t.dispose();
	expect(stop).toHaveBeenCalledOnce();
});
