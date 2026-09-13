import { ApiException } from "@kubernetes/client-node";
import pino from "pino";
import { expect, it } from "vitest";
import { safeExecutionError, safeProcessError } from "./errors.js";

it("retains API authorization status and a bounded safe cause chain", () => {
  const nested = Object.assign(new Error("private-cause-canary"), {
    code: "ENOSPC",
    syscall: "write",
  });
  const original = new ApiException(
    403,
    "submitted-command-canary",
    { message: "result-canary" },
    { header: "private-header-canary" },
  );
  original.cause = nested;
  const safe = safeExecutionError(original);
  expect(safe).toMatchObject({
    kind: "infrastructure",
    message: "Execution failed.",
    cause: {
      category: "http",
      httpStatus: 403,
      name: "ApiException",
      cause: { code: "ENOSPC", syscall: "write", category: "filesystem" },
    },
  });
  const bytes = JSON.stringify(pino.stdSerializers.errWithCause(safe));
  for (const secret of [
    "private-cause-canary",
    "submitted-command-canary",
    "result-canary",
    "private-header-canary",
  ])
    expect(bytes).not.toContain(secret);
  expect(bytes).not.toContain("stack");
});
it("rejects unlisted diagnostic fields and bounds cyclic or long cause chains", () => {
  const original = Object.assign(new Error("unsafe"), {
    name: "unsafe-name",
    code: "UNTRUSTED_CANARY",
    syscall: "cat-private-canary",
    statusCode: 999,
    body: "unsafe-body",
  });
  original.cause = original;
  expect(safeExecutionError(original)).toMatchObject({
    cause: { category: "runtime", name: "Error", causeTruncated: true },
  });
  const serialized = JSON.stringify(
    pino.stdSerializers.errWithCause(safeProcessError(original)),
  );
  expect(serialized).not.toContain("unsafe");
  expect(serialized).not.toContain("UNTRUSTED_CANARY");
  expect(serialized).not.toContain("999");
  let error: Error = new Error("tail");
  for (let index = 0; index < 10; index++)
    error = new Error("unsafe", { cause: error });
  const safe = safeExecutionError(error);
  const bytes = JSON.stringify(pino.stdSerializers.errWithCause(safe));
  expect(bytes.match(/Backend operation failed\./g)).toHaveLength(3);
  expect(bytes).toContain("causeTruncated");
});
