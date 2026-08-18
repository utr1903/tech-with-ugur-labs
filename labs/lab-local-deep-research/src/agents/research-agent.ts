import type { ChatOllama } from "@langchain/ollama";
import { createDeepAgent, FilesystemBackend } from "deepagents";
import { todoListMiddleware } from "langchain";
import type { createInternetSearchTool } from "../search/tavily-tool.js";
import { RESEARCH_SYSTEM_PROMPT } from "./prompts.js";
import {
  createToolAllowlistMiddleware,
  RESEARCH_AGENT_TOOLS,
} from "./tool-allowlist.js";

export function buildResearchAgent({
  model,
  searchTool,
  topicDir,
}: {
  model: ChatOllama;
  searchTool: ReturnType<typeof createInternetSearchTool>;
  topicDir: string;
}) {
  return createDeepAgent({
    model,
    tools: [searchTool],
    // virtualMode: the system prompt has the agent address files as absolute
    // paths (/report.md, /notes/*.md). Without this, FilesystemBackend passes
    // absolute paths through as real filesystem paths, escaping topicDir entirely.
    backend: new FilesystemBackend({ rootDir: topicDir, virtualMode: true }),
    systemPrompt: RESEARCH_SYSTEM_PROMPT,
    middleware: [
      todoListMiddleware(),
      createToolAllowlistMiddleware({ allowedTools: RESEARCH_AGENT_TOOLS }),
    ],
  });
}
