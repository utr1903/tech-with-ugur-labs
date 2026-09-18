import { describe, expect, it } from "vitest";
import { parseSandboxResult } from "./sandbox-result";

const execution = {
  status: "succeeded",
  exitCode: 0,
  stdout: "4\n",
  stderr: "",
  result: { a: 1 },
  resultError: null,
  durationMs: 9,
  truncated: false,
};

describe("parseSandboxResult", () => {
  it("is pending while there is no result", () => {
    expect(parseSandboxResult(undefined)).toEqual({ kind: "pending" });
  });

  it("parses the JSON string content the server sends", () => {
    expect(parseSandboxResult(JSON.stringify(execution))).toEqual({
      kind: "execution",
      ...execution,
    });
  });

  it("accepts an already-parsed object", () => {
    expect(parseSandboxResult(execution)).toMatchObject({
      kind: "execution",
      status: "succeeded",
    });
  });

  it("surfaces tool errors and unreadable content", () => {
    expect(
      parseSandboxResult(
        JSON.stringify({ error: "sandbox_busy", message: "busy" }),
      ),
    ).toEqual({ kind: "error", message: "sandbox_busy: busy" });
    expect(parseSandboxResult("not json")).toEqual({
      kind: "error",
      message: "unreadable tool result",
    });
  });
});
