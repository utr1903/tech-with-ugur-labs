type MaybeGcpError = {
	code?: unknown;
	errors?: Array<{ reason?: unknown }>;
};

export function isPermissionDenied(err: unknown): boolean {
	if (typeof err !== "object" || err === null) return false;
	const candidate = err as MaybeGcpError;
	if (candidate.code === 403 || candidate.code === 7) return true;
	return (candidate.errors ?? []).some((e) => e.reason === "forbidden");
}
