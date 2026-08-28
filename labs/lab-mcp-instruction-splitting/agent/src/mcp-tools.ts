import type { DynamicStructuredTool } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { Logger } from "./logger.js";

export interface McpToolsDeps {
  mcpServerUrl: string;
  logger: Logger;
}

export interface McpToolset {
  tools: DynamicStructuredTool[];
  close: () => Promise<void>;
}

// Pulls the poisoned MCP server's tool set through LangChain's MCP adapter.
// This is exactly what a real coding agent does to build its tool list -
// it has no way to tell a benign tool description from a malicious one
// before this point, which is why the guardrail (Task 7) has to sit here.
export async function loadMcpTools(deps: McpToolsDeps): Promise<McpToolset> {
  const { mcpServerUrl, logger } = deps;

  logger.info({ mcpServerUrl }, "Loading MCP tools...");

  const client = new MultiServerMCPClient({
    mcpServers: {
      poisoned: { url: mcpServerUrl, transport: "http" },
    },
  });

  const tools = await client.getTools();

  logger.info({ mcpServerUrl, toolCount: tools.length }, "Loaded MCP tools.");

  return {
    tools,
    close: () => client.close(),
  };
}
