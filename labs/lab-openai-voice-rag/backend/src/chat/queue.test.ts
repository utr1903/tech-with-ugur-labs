import { expect, it } from "vitest";
import { createQueue } from "./queue.js";

it("serializes a chat while other chats proceed and recovers after a failed turn", async () => {
	const enqueue = createQueue();
	const signal = new AbortController().signal;
	let release = () => {};
	const held = new Promise<void>((r) => {
		release = r;
	});
	const order: string[] = [];
	const first = enqueue("a", signal, async () => {
		order.push("first");
		await held;
		throw Error("failed");
	});
	const outcomes = Promise.allSettled([
		first,
		enqueue("a", signal, async () => {
			order.push("second");
		}),
	]);
	await enqueue("b", signal, async () => {
		order.push("other");
	});
	expect(order).toEqual(["first", "other"]);
	release();
	await outcomes;
	expect(order).toEqual(["first", "other", "second"]);
});
it("bounds queued turns and prevents cancelled queued work from starting", async () => {
	const enqueue = createQueue(1, 2);
	const signal = new AbortController().signal;
	let release = () => {};
	const held = new Promise<void>((r) => {
		release = r;
	});
	const abort = new AbortController();
	let started = false;
	const first = enqueue("a", signal, () => held);
	const second = enqueue("a", abort.signal, async () => {
		started = true;
	});
	const outcomes = Promise.allSettled([first, second]);
	expect(() => enqueue("a", signal, async () => {})).toThrow("queue capacity");
	expect(() => enqueue("b", signal, async () => {})).toThrow("Agent capacity");
	abort.abort(Error("cancelled"));
	release();
	await outcomes;
	expect(started).toBe(false);
	await enqueue("b", signal, async () => {});
});
