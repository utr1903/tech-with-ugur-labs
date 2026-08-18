import { createMiddleware } from "langchain";

export const RESEARCH_AGENT_TOOLS = [
  "internet_search",
  "write_todos",
  "ls",
  "read_file",
  "write_file",
] as const;

export const ANALYZE_AGENT_TOOLS = ["ls", "read_file", "glob", "grep"] as const;

export function createToolAllowlistMiddleware({
  allowedTools,
}: {
  allowedTools: readonly string[];
}) {
  const allowed = new Set(allowedTools);
  return createMiddleware({
    name: "ToolAllowlistMiddleware",
    wrapModelCall: (request, handler) =>
      handler({
        ...request,
        tools: request.tools.filter((candidate) =>
          allowed.has((candidate as { name: string }).name),
        ),
      }),
  });
}
