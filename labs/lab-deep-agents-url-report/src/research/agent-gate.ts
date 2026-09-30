import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import type { Logger } from "../logger.js";
import type { ResearchTools } from "./firecrawl-types.js";

const permitted = new Set([
  "write_todos",
  "read_page",
  "search_web",
  "crawl_site",
]);
export function createAgentGate(
  research: ResearchTools,
  logger: Logger,
  signal: AbortSignal,
) {
  let planned = false;
  let revision = 0;
  const middleware = createMiddleware({
    name: "ResearchBoundary",
    wrapModelCall: (request, handler) =>
      handler({
        ...request,
        tools: request.tools.filter(
          (tool) =>
            "name" in tool &&
            typeof tool.name === "string" &&
            permitted.has(tool.name),
        ),
      }),
    wrapToolCall: async (request, handler) => {
      const { name, id } = request.toolCall;
      const reason = denialReason(name, signal.aborted, planned);
      if (reason) {
        research.record({
          kind: reason === "time-budget" ? "cap" : "denial",
          operation: name,
          reason,
        });
        return new ToolMessage({
          content: JSON.stringify({ ok: false, recoverable: true, reason }),
          tool_call_id: id ?? "",
          name,
        });
      }
      const result = await handler(request);
      if (name === "write_todos") {
        const todos = request.toolCall.args.todos;
        if (Array.isArray(todos) && todos.length > 0) {
          planned = true;
          revision += 1;
          const statuses = ["pending", "in_progress", "completed"]
            .map(
              (status) =>
                `${status}=${todos.filter((todo) => todo.status === status).length}`,
            )
            .join(",");
          research.record({
            kind: "plan",
            operation: `plan-${revision}:${statuses}`,
          });
          logger.info(
            { revision, taskCount: todos.length },
            "Recording research plan succeeded.",
          );
        }
      }
      return result;
    },
  });
  return {
    middleware,
    hasPlan: () => planned,
    requireRevision: () => {
      planned = false;
    },
  };
}

function denialReason(name: string, aborted: boolean, planned: boolean) {
  if (!permitted.has(name)) return "tool-not-permitted";
  if (aborted) return "time-budget";
  if (name !== "write_todos" && !planned) return "plan-required";
  return undefined;
}
