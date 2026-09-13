import { describe, expect, it } from "vitest";
import { createCodeExecutorTool } from "./code-executor-tool.js";
import type { ExecuteClient, ExecuteOutcome } from "./execute-client.js";
import { sampleCapabilities } from "./test-fixtures.js";

function toolReturning(outcome: ExecuteOutcome) {
  const client: ExecuteClient = { execute: async () => outcome };
  return createCodeExecutorTool({ capabilities: sampleCapabilities, client });
}

describe("code_executor tool", () => {
  it("is named code_executor, described from capabilities and documents its field", () => {
    const tool = toolReturning({ kind: "busy" });
    expect(tool.name).toBe("code_executor");
    expect(tool.description).toContain("numpy (numpy 2.5.3)");
  });

  it("returns the sandbox execution as JSON content", async () => {
    const execution = {
      status: "succeeded" as const,
      exitCode: 0,
      stdout: "ok\n",
      stderr: "",
      result: { x: 1 },
      resultError: null,
      durationMs: 3,
      truncated: false,
    };
    const content = await toolReturning({ kind: "executed", execution }).invoke(
      { code: "print('ok')" },
    );
    expect(JSON.parse(String(content))).toEqual(execution);
  });

  it.each([
    [{ kind: "busy" } as const, "sandbox_busy"],
    [{ kind: "unreachable", message: "down" } as const, "sandbox_unreachable"],
    [
      { kind: "rejected", message: "too big" } as const,
      "sandbox_rejected_code",
    ],
  ])(
    "returns %o as a structured error instead of throwing",
    async (outcome, error) => {
      const content = await toolReturning(outcome).invoke({ code: "x" });
      expect(JSON.parse(String(content))).toMatchObject({ error });
    },
  );

  it("rejects empty code at the schema", async () => {
    await expect(
      toolReturning({ kind: "busy" }).invoke({ code: "" }),
    ).rejects.toThrow();
  });
});
