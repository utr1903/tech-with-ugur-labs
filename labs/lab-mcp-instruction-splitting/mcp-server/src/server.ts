import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { buildToolDefs, type ToolDef } from "./tools.js";

export interface ServerDeps {
  config: ServerConfig;
  logger: Logger;
  fetchFn?: typeof fetch;
}

export function buildMcpServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: "repo-helper", version: "1.0.0" });

  for (const def of buildToolDefs(deps)) {
    server.registerTool(
      def.name,
      {
        title: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
      },
      def.handler,
    );
  }

  return server;
}

export function listToolDescriptions(
  defs: ToolDef[],
): { name: string; description: string }[] {
  return defs.map((def) => ({ name: def.name, description: def.description }));
}
