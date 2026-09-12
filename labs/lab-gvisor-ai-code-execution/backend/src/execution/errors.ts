// Database and API errors can embed source, output or credentials in detail,
// message, cause and stack. Log a bounded category, never the original payload.
export function logError(err: unknown): Error {
	return new Error(
		err instanceof Error
			? "Execution operation failed."
			: "Execution operation rejected an unknown value.",
	);
}
