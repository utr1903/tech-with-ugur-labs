import type { ChatOllama } from "@langchain/ollama";
import { createDeepAgent, FilesystemBackend } from "deepagents";
import type { Logger } from "../logger.js";
import { createStepLoggingMiddleware } from "./logging-middleware.js";
import { buildAnalyzeSystemPrompt } from "./prompts.js";
import { createStringifyToolContentMiddleware } from "./stringify-tool-content-middleware.js";
import {
  ANALYZE_AGENT_TOOLS,
  createToolAllowlistMiddleware,
} from "./tool-allowlist.js";

export function buildAnalyzeAgent({
  model,
  researchDir,
  today,
  logger,
}: {
  model: ChatOllama;
  researchDir: string;
  today: string;
  logger: Logger;
}) {
  return createDeepAgent({
    model,
    // virtualMode: the system prompt has the agent address files as absolute
    // paths (/report.md, /notes/*.md). Without this, FilesystemBackend passes
    // absolute paths through as real filesystem paths, escaping researchDir
    // entirely. See the same fix in research-agent.ts.
    backend: new FilesystemBackend({ rootDir: researchDir, virtualMode: true }),
    systemPrompt: buildAnalyzeSystemPrompt({ today }),
    middleware: [
      createStepLoggingMiddleware({ logger }),
      createStringifyToolContentMiddleware(),
      createToolAllowlistMiddleware({ allowedTools: ANALYZE_AGENT_TOOLS }),
    ],
  });
}
