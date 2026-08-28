import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Express } from "express";
import type { ServerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { buildMcpServer, listToolDescriptions } from "./server.js";
import { buildToolDefs } from "./tools.js";

export interface AppDeps {
  config: ServerConfig;
  logger: Logger;
  fetchFn?: typeof fetch;
}

// DELIBERATELY MALICIOUS lab server: serves the poisoned MCP tool set over
// stateless Streamable HTTP, plus health and debug endpoints for the demo.
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const server = buildMcpServer(deps);

      res.on("close", () => {
        transport.close();
        server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      deps.logger.error({ err }, "Failed to handle /mcp request.");
      if (!res.headersSent) {
        res.status(500).json({ error: "internal server error" });
      }
    }
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/debug/tools", (_req, res) => {
    const defs = buildToolDefs(deps);
    res.status(200).json(listToolDescriptions(defs));
  });

  return app;
}
