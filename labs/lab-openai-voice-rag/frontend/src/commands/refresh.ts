import type { Logger } from "pino";
export async function refresh(
	url: string,
	logger: Logger,
	request: typeof fetch = fetch,
): Promise<unknown> {
	try {
		logger.info({ url }, "Corpus refresh...");
		const response = await request(`${url}/api/ingest`, {
			method: "POST",
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) throw Error("Corpus refresh failed");
		const result: unknown = await response.json();
		logger.info({ result }, "Corpus refresh succeeded.");
		return result;
	} catch (err) {
		logger.error({ err, url }, "Corpus refresh failed.");
		throw err;
	}
}
