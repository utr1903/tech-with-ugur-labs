import { ApiException } from "@kubernetes/client-node";
import { ExecutionError } from "../execution/types.js";

const filesystemCodes = new Set([
  "EACCES",
  "EBADF",
  "EBUSY",
  "EDQUOT",
  "EEXIST",
  "EFBIG",
  "EIO",
  "EISDIR",
  "ELOOP",
  "EMFILE",
  "ENAMETOOLONG",
  "ENFILE",
  "ENOENT",
  "ENOSPC",
  "ENOSYS",
  "ENOTDIR",
  "ENOTEMPTY",
  "EPERM",
  "EROFS",
  "EINVAL",
]);
const networkCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const names = new Set([
  "Error",
  "TypeError",
  "SyntaxError",
  "RangeError",
  "ReferenceError",
  "ApiException",
  "AbortError",
  "TimeoutError",
  "SystemError",
  "ExecutionError",
]);
const syscalls = new Set([
  "open",
  "read",
  "write",
  "stat",
  "fstat",
  "lstat",
  "scandir",
  "mkdir",
  "chmod",
  "chown",
  "lchown",
  "fchmod",
  "unlink",
  "rmdir",
  "rename",
  "close",
  "fsync",
  "truncate",
  "readlink",
  "access",
  "connect",
  "getaddrinfo",
  "listen",
]);

// Read data properties only: messages, bodies, paths, headers, and stacks are
// deliberately excluded, and getters supplied by a backend are never invoked.
function own(err: unknown, key: string): unknown {
  if (typeof err !== "object" || err === null) return undefined;
  return Object.getOwnPropertyDescriptor(err, key)?.value;
}
// Only allow recognized diagnostic values; arbitrary strings can contain submitted data.
function listed(value: unknown, allowed: Set<string>): string | undefined {
  return typeof value === "string" && allowed.has(value) ? value : undefined;
}
// Retain numeric HTTP status without exposing response bodies or headers.
function status(err: unknown): number | undefined {
  for (const key of ["code", "statusCode", "httpStatus"]) {
    const value = own(err, key);
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 100 &&
      value <= 599
    )
      return value;
  }
  return undefined;
}
// Prefer known exception classes, then allowlisted names rather than arbitrary backend text.
function errorName(err: unknown): string {
  if (err instanceof ApiException) return "ApiException";
  if (err instanceof ExecutionError) return "ExecutionError";
  if (err instanceof SyntaxError) return "SyntaxError";
  if (err instanceof TypeError) return "TypeError";
  return listed(own(err, "name"), names) ?? "Error";
}
// Classify failures from safe codes/types so diagnostics remain useful without raw messages.
function category(
  err: unknown,
  name: string,
  code: string | undefined,
  httpStatus: number | undefined,
): string {
  if (httpStatus !== undefined) return "http";
  if (code && filesystemCodes.has(code)) return "filesystem";
  if (code && networkCodes.has(code)) return "network";
  if (name === "SyntaxError") return "syntax";
  if (name === "ExecutionError") return "execution";
  return err instanceof Error ? "runtime" : "unknown";
}
// Rebuild causes with bounded depth and cycle detection instead of serializing backend objects.
function diagnostic(
  err: unknown,
  depth = 0,
  seen = new Set<object>(),
): Error | undefined {
  if (depth >= 3 || (typeof err === "object" && err !== null && seen.has(err)))
    return undefined;
  if (typeof err === "object" && err !== null) seen.add(err);
  const code =
    listed(own(err, "code"), filesystemCodes) ??
    listed(own(err, "code"), networkCodes);
  const syscall = listed(own(err, "syscall"), syscalls);
  const httpStatus = status(err);
  const name = errorName(err);
  const safe = Object.assign(new Error("Backend operation failed."), {
    name,
    category: category(err, name, code, httpStatus),
    ...(code ? { code } : {}),
    ...(syscall ? { syscall } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
  });
  // A fresh stack still contains implementation paths and is unnecessary for these safe diagnostics.
  delete safe.stack;
  const sourceCause = own(err, "cause");
  if (sourceCause !== undefined) {
    const cause = diagnostic(sourceCause, depth + 1, seen);
    if (cause) safe.cause = cause;
    else Object.assign(safe, { causeTruncated: true });
  }
  if (own(err, "causeTruncated") === true)
    Object.assign(safe, { causeTruncated: true });
  return safe;
}

// Preserve client-facing execution kind while replacing every backend cause with safe diagnostics.
export function safeExecutionError(err: unknown): ExecutionError {
  const failure = new ExecutionError(
    err instanceof ExecutionError ? err.kind : "infrastructure",
  );
  delete failure.stack;
  const source = err instanceof ExecutionError ? own(err, "cause") : err;
  if (source !== undefined) failure.cause = diagnostic(source);
  return failure;
}
// Apply the same diagnostic boundary to unexpected top-level process failures.
export function safeProcessError(err: unknown): Error {
  const failure = new Error("Unexpected process failure", {
    cause: diagnostic(err),
  });
  delete failure.stack;
  return failure;
}
