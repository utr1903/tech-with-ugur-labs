/**
 * Reduces an error to fields that are safe to log. AWS SDK error messages
 * can contain local file paths of the login cache, so the message and the
 * stack are left out on purpose.
 */
export function describeError(err: unknown): {
  errorName: string;
  httpStatusCode?: number;
} {
  if (!(err instanceof Error)) {
    return { errorName: "UnknownError" };
  }
  const status = (err as { $metadata?: { httpStatusCode?: unknown } }).$metadata
    ?.httpStatusCode;
  return typeof status === "number"
    ? { errorName: err.name, httpStatusCode: status }
    : { errorName: err.name };
}
