import { createMiddleware } from "langchain";

export interface RecordedToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolCallRecorder {
  middleware: ReturnType<typeof createMiddleware>;
  calls: RecordedToolCall[];
}

// Captures every executed tool call so the scripted verification run can
// assert on what the agent actually did instead of on model prose.
export function createToolCallRecorder(): ToolCallRecorder {
  const calls: RecordedToolCall[] = [];
  const middleware = createMiddleware({
    name: "ToolCallRecorder",
    wrapToolCall: async (request, handler) => {
      calls.push({
        tool: request.toolCall.name,
        args: { ...(request.toolCall.args ?? {}) },
      });
      return handler(request);
    },
  });
  return { middleware, calls };
}
