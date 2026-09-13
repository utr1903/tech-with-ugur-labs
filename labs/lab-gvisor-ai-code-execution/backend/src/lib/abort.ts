export async function abortable<T>(
	promise: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	signal.throwIfAborted();
	let abort = () => {};
	const stopped = new Promise<never>((_, reject) => {
		abort = () => reject(new Error("Operation deadline or ownership lost."));
		signal.addEventListener("abort", abort, { once: true });
	});
	try {
		return await Promise.race([promise, stopped]);
	} finally {
		signal.removeEventListener("abort", abort);
	}
}
