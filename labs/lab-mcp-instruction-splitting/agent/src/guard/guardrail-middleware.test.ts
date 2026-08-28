import { describe, expect, it } from "vitest";
import {
  APPROVED_EGRESS_TOOLS,
  createGuardrailMiddleware,
} from "./guardrail-middleware.js";

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
    warn: record("warn"),
    error: record("error"),
  } as unknown as Parameters<typeof createGuardrailMiddleware>[0]["logger"];
}

// Direct casts: exercising the hook with minimal request shapes.
type Hook = (request: unknown, handler: unknown) => Promise<unknown>;

describe("APPROVED_EGRESS_TOOLS", () => {
  it("excludes submit_telemetry", () => {
    expect(APPROVED_EGRESS_TOOLS).not.toContain("submit_telemetry");
  });
});

describe("createGuardrailMiddleware wrapToolCall (egress deny)", () => {
  it("blocks a tool call that is not on the approved egress allowlist", async () => {
    const entries: LogEntry[] = [];
    const middleware = createGuardrailMiddleware({
      logger: collectingLogger(entries),
    });
    const request = {
      toolCall: { id: "call-1", name: "submit_telemetry", args: {} },
    };
    let handlerCalled = false;
    const handler = () => {
      handlerCalled = true;
      return Promise.resolve({ content: "telemetry accepted" });
    };

    const result = (await (middleware.wrapToolCall as Hook)(
      request,
      handler,
    )) as { content: string; tool_call_id: string };

    expect(handlerCalled).toBe(false);
    expect(result.content).toContain("blocked");
    expect(result.tool_call_id).toBe("call-1");
    const denyLog = entries.find((entry) => entry.msg.includes("Denied"));
    expect(denyLog).toBeDefined();
    expect(denyLog?.fields.tool).toBe("submit_telemetry");
  });

  it("passes an approved tool call through to the handler", async () => {
    const entries: LogEntry[] = [];
    const middleware = createGuardrailMiddleware({
      logger: collectingLogger(entries),
    });
    const request = {
      toolCall: { id: "call-2", name: "read_file", args: { path: "/x" } },
    };
    const handler = (r: unknown) => Promise.resolve({ passed: r });

    const result = (await (middleware.wrapToolCall as Hook)(
      request,
      handler,
    )) as { passed: unknown };

    expect(result.passed).toBe(request);
    expect(
      entries.find((entry) => entry.msg.includes("Denied")),
    ).toBeUndefined();
  });
});
