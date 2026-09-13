import type { Executor } from "./execution/execute.js";
import type { Logger } from "./logger.js";
import type { ThreadService } from "./threads/service.js";
export function recovery(
	executor: Executor,
	service: ThreadService,
	logger: Logger,
) {
	let active = false;
	const run = async () => {
		if (active) return;
		active = true;
		try {
			await executor.reconcileOutstanding();
			await service.recover();
		} catch (err) {
			logger.error({ err }, "Reconciling application failed.");
		} finally {
			active = false;
		}
	};
	void run();
	const interval = setInterval(() => void run(), 5000);
	interval.unref();
	return () => clearInterval(interval);
}
