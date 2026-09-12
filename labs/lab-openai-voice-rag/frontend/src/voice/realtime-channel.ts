export function channelReady(channel: RTCDataChannel, signal: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			channel.removeEventListener("open", open);
			channel.removeEventListener("error", error);
			signal.removeEventListener("abort", error);
		};
		const open = () => {
			cleanup();
			resolve();
		};
		const error = () => {
			cleanup();
			reject(Error("Connection interrupted"));
		};
		if (signal.aborted) {
			error();
			return;
		}
		if (channel.readyState === "open") {
			open();
			return;
		}
		channel.addEventListener("open", open, { once: true });
		channel.addEventListener("error", error, { once: true });
		signal.addEventListener("abort", error, { once: true });
	});
}
