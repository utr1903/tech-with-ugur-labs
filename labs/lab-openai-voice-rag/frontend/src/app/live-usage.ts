function numericUsage(value: unknown) {
	const result: Record<string, number> = {};
	if (!value || typeof value !== "object") return result;
	for (const key of ["input_tokens", "output_tokens", "total_tokens"]) {
		const count = (value as Record<string, unknown>)[key];
		if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0)
			result[key] = count;
	}
	return result;
}
/** Capture only observed token counts; missing usage is never estimated. */
export function completionUsage(events: Record<string, unknown>[]) {
	return events.flatMap((event) => {
		if (event.type !== "response.done") return [];
		const response = event.response;
		if (!response || typeof response !== "object" || !("usage" in response))
			return [];
		const usage = numericUsage(response.usage);
		return Object.keys(usage).length ? [usage] : [];
	});
}
