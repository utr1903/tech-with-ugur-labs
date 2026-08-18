import type { ChatOllama } from "@langchain/ollama";
import { createDeepAgent, FilesystemBackend } from "deepagents";
import type { Logger } from "../logger.js";
import type { createInternetSearchTool } from "../search/tavily-tool.js";
import { createStepLoggingMiddleware } from "./logging-middleware.js";
import { buildResearchSystemPrompt } from "./prompts.js";
import { createStringifyToolContentMiddleware } from "./stringify-tool-content-middleware.js";
import {
  createToolAllowlistMiddleware,
  RESEARCH_AGENT_TOOLS,
} from "./tool-allowlist.js";

export function buildResearchAgent({
  model,
  searchTool,
  topicDir,
  today,
  logger,
}: {
  model: ChatOllama;
  searchTool: ReturnType<typeof createInternetSearchTool>;
  topicDir: string;
  today: string;
  logger: Logger;
}) {
  return createDeepAgent({
    model,
    tools: [searchTool],
    // virtualMode: the system prompt has the agent address files as absolute
    // paths (/report.md, /notes/*.md). Without this, FilesystemBackend passes
    // absolute paths through as real filesystem paths, escaping topicDir entirely.
    backend: new FilesystemBackend({ rootDir: topicDir, virtualMode: true }),
    systemPrompt: buildResearchSystemPrompt({ today }),
    middleware: [
      createStepLoggingMiddleware({ logger }),
      createStringifyToolContentMiddleware(),
      createToolAllowlistMiddleware({ allowedTools: RESEARCH_AGENT_TOOLS }),
    ],
  });
}
