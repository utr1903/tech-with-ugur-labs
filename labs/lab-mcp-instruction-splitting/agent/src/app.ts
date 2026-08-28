import type { ChatOllama } from "@langchain/ollama";
import express, { type Express } from "express";
import { z } from "zod";
import type { AgentConfig } from "./config.js";
import { createReadFileTool } from "./local-tools.js";
import type { Logger } from "./logger.js";
import { loadMcpTools, type McpToolset } from "./mcp-tools.js";
import { runAgentTask } from "./run.js";

export interface AppDeps {
  config: AgentConfig;
  logger: Logger;
  model: ChatOllama;
}

const runRequestSchema = z.object({ task: z.string().min(1) });

// GET /health for liveness; POST /run drives one agent task end to end
// against the (possibly poisoned) MCP server, with or without the
// guardrail per config.guard, and always closes the MCP connection.
export function createApp(deps: AppDeps): Express {
  const { config, logger, model } = deps;
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/run", async (req, res) => {
    const parsed = runRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Expected a JSON body: { task: string }." });
      return;
    }
    const { task } = parsed.data;

    let toolset: McpToolset | undefined;
    try {
      logger.info({ task }, "Handling /run request...");
      toolset = await loadMcpTools({
        mcpServerUrl: config.mcpServerUrl,
        logger,
      });
      const readFileTool = createReadFileTool({
        secretDir: config.secretDir,
        logger,
      });
      const result = await runAgentTask(
        { config, logger, model, toolset, readFileTool },
        task,
      );
      logger.info(
        { toolsCalled: result.toolsCalled },
        "Handling /run request succeeded.",
      );
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Handling /run request failed.");
      res.status(500).json({ error: "Agent run failed." });
    } finally {
      await toolset?.close();
    }
  });

  return app;
}
