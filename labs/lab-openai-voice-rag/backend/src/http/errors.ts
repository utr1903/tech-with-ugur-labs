export class SafeError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 404 | 429 | 502 | 504 = 502,
	) {
		super(message);
	}
}
export function safeError(err: unknown): SafeError {
	return err instanceof SafeError
		? err
		: new SafeError("Service operation failed. Please retry.");
}
