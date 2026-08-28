import { describe, expect, it } from "vitest";
import { createStepLoggingMiddleware } from "./logging-middleware.js";

interface LogEntry {
  level: string;
  fields: Record<string, unknown>;
  msg: string;
}

function collectingLogger(entries: LogEntry[]) {
  const record =
    (level: string) =>
    (fields: Record<string, unknown>, msg: string): void => {
      entries.push({ level, fields, msg });
    };
  return {
    info: record("info"),
    error: record("error"),
  } as unknown as Parameters<typeof createStepLoggingMiddleware>[0]["logger"];
}

// Direct casts: exercising the hooks with minimal request shapes.
type Hook = (request: unknown, handler: unknown) => Promise<unknown>;

describe("createStepLoggingMiddleware wrapModelCall", () => {
  it("logs every model turn start and success", async () => {
    const entries: LogEntry[] = [];
    const middleware = createStepLoggingMiddleware({
      logger: collectingLogger(entries),
    });
    const request = { messages: [{}, {}] };
    const aiMessage = { tool_calls: [{ name: "get_repo_info" }] };

    const result = await (middleware.wrapModelCall as Hook)(request, () =>
      Promise.resolve(aiMessage),
    );

    expect(result).toBe(aiMessage);
    expect(entries.map((entry) => entry.msg)).toEqual([
      "Model turn starting...",
      "Model turn succeeded.",
    ]);
    expect(entries[0]?.fields).toMatchObject({ turn: 1, messageCount: 2 });
    expect(entries[1]?.fields).toMatchObject({
      turn: 1,
      toolCallsRequested: ["get_repo_info"],
    });
  });

  it("logs model turn failures and rethrows", async () => {
    const entries: LogEntry[] = [];
    const middleware = createStepLoggingMiddleware({
      logger: collectingLogger(entries),
    });
    const request = { messages: [] };
    const failure = new Error("model unavailable");

    await expect(
      (middleware.wrapModelCall as Hook)(request, () =>
        Promise.reject(failure),
      ),
    ).rejects.toThrow("model unavailable");
    expect(entries[1]?.level).toBe("error");
    expect(entries[1]?.msg).toBe("Model turn failed.");
    expect(entries[1]?.fields.err).toBe(failure);
  });
});

describe("createStepLoggingMiddleware wrapToolCall", () => {
  it("logs every tool call start and success with the tool name", async () => {
    const entries: LogEntry[] = [];
    const middleware = createStepLoggingMiddleware({
      logger: collectingLogger(entries),
    });
    const request = { toolCall: { name: "read_file", args: { path: "/x" } } };

    const result = await (middleware.wrapToolCall as Hook)(request, () =>
      Promise.resolve({ content: "ok" }),
    );

    expect(result).toEqual({ content: "ok" });
    expect(entries.map((entry) => entry.msg)).toEqual([
      "Tool call starting...",
      "Tool call succeeded.",
    ]);
    expect(entries[0]?.fields.tool).toBe("read_file");
    expect(entries[0]?.fields.args).toContain("path");
  });

  it("logs tool call failures and rethrows", async () => {
    const entries: LogEntry[] = [];
    const middleware = createStepLoggingMiddleware({
      logger: collectingLogger(entries),
    });
    const request = { toolCall: { name: "check_style", args: {} } };
    const failure = new Error("boom");

    await expect(
      (middleware.wrapToolCall as Hook)(request, () => Promise.reject(failure)),
    ).rejects.toThrow("boom");
    expect(entries[1]?.level).toBe("error");
    expect(entries[1]?.msg).toBe("Tool call failed.");
    expect(entries[1]?.fields.tool).toBe("check_style");
    expect(entries[1]?.fields.err).toBe(failure);
  });
});
