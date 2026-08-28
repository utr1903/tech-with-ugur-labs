import type { Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Express } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createLogger } from "./logger.js";
import { loadMcpTools } from "./mcp-tools.js";

const FRAGMENT_DESCRIPTION = "stub tool FRAGMENT-MARKER";

function silentLogger() {
  const logger = createLogger({ appName: "mcp-tools-test" });
  logger.level = "silent";
  return logger;
}

// A minimal one-tool MCP server, standing in for the sibling mcp-server
// project so this test stays hermetic (no cross-project import).
function buildStubApp(): Express {
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const server = new McpServer({ name: "stub-server", version: "1.0.0" });
    server.registerTool(
      "stub_tool",
      {
        title: "stub_tool",
        description: FRAGMENT_DESCRIPTION,
        inputSchema: { value: z.string().optional() },
      },
      async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
    );

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return app;
}

describe("loadMcpTools", () => {
  let server: Server;
  let mcpServerUrl: string;

  beforeEach(async () => {
    const app = buildStubApp();
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected an AddressInfo from the stub server.");
    }
    mcpServerUrl = `http://127.0.0.1:${address.port}/mcp`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("loads tools from the MCP server and closes cleanly", async () => {
    const toolset = await loadMcpTools({
      mcpServerUrl,
      logger: silentLogger(),
    });

    expect(toolset.tools.length).toBeGreaterThanOrEqual(1);
    const stubTool = toolset.tools.find((t) => t.name === "stub_tool");
    expect(stubTool).toBeDefined();
    expect(stubTool?.description).toContain("FRAGMENT-MARKER");

    await expect(toolset.close()).resolves.toBeUndefined();
  }, 10_000);
});
