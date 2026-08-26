const defaultSleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function retryUntilSuccess<T>(
	op: () => Promise<T>,
	opts: {
		attempts?: number;
		initialDelayMs?: number;
		factor?: number;
		sleep?: (ms: number) => Promise<void>;
	} = {},
): Promise<T> {
	const {
		attempts = 10,
		initialDelayMs = 2000,
		factor = 1.5,
		sleep = defaultSleep,
	} = opts;
	let delayMs = initialDelayMs;
	let lastError: unknown;

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			return await op();
		} catch (err) {
			lastError = err;
			if (attempt < attempts) {
				await sleep(delayMs);
				delayMs *= factor;
			}
		}
	}
	throw lastError;
}

export async function expectConsistentDenial(
	op: () => Promise<unknown>,
	opts: {
		isExpectedDenial: (err: unknown) => boolean;
		attempts?: number;
		delayMs?: number;
		sleep?: (ms: number) => Promise<void>;
	},
): Promise<{ deniedConsistently: boolean; detail: string }> {
	const {
		isExpectedDenial,
		attempts = 3,
		delayMs = 20000,
		sleep = defaultSleep,
	} = opts;

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			await op();
			return {
				deniedConsistently: false,
				detail: `attempt ${attempt}/${attempts} unexpectedly succeeded`,
			};
		} catch (err) {
			if (!isExpectedDenial(err)) {
				return {
					deniedConsistently: false,
					detail: `attempt ${attempt}/${attempts} failed with a non-denial error: ${String(err)}`,
				};
			}
		}
		if (attempt < attempts) await sleep(delayMs);
	}
	return {
		deniedConsistently: true,
		detail: `denied on all ${attempts} attempts`,
	};
}
