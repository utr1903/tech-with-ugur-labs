import { SafeError } from "./http/errors.js";
import type { Logger } from "./logger.js";

export async function logOperation<T>(
	logger: Logger,
	name: string,
	fields: Record<string, unknown>,
	work: () => Promise<T>,
	summary: (result: T) => Record<string, unknown>,
): Promise<T> {
	const started = performance.now();
	logger.info(fields, `${name}...`);
	try {
		const result = await work();
		logger.info(
			{
				...fields,
				...summary(result),
				durationMs: performance.now() - started,
			},
			`${name} succeeded.`,
		);
		return result;
	} catch (err) {
		logger.error(
			{
				...fields,
				err: new SafeError(
					`${name} failed; details withheld`,
					err instanceof SafeError ? err.status : 502,
				),
				durationMs: performance.now() - started,
				cancelled:
					err instanceof Error &&
					(err.name === "AbortError" || err.name === "TimeoutError"),
			},
			`${name} failed.`,
		);
		throw err;
	}
}
