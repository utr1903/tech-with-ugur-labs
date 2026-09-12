import { SafeError } from "../http/errors.js";
export function createTurnDeadline(
	lifecycle: AbortSignal,
	milliseconds: number,
) {
	const controller = new AbortController();
	const signal = AbortSignal.any([lifecycle, controller.signal]);
	const timer = setTimeout(
		() => controller.abort(new SafeError("Turn deadline exceeded", 504)),
		milliseconds,
	);
	let abort: () => void = () => {};
	const cancelled = new Promise<never>((_resolve, reject) => {
		abort = () => reject(signal.reason);
		if (signal.aborted) abort();
		else signal.addEventListener("abort", abort, { once: true });
	});
	return {
		signal,
		cancelled,
		close() {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
		},
	};
}
