import type { ChatOllama } from "@langchain/ollama";
import { createDeepAgent, FilesystemBackend } from "deepagents";
import { ANALYZE_SYSTEM_PROMPT } from "./prompts.js";
import { createStringifyToolContentMiddleware } from "./stringify-tool-content-middleware.js";
import {
  ANALYZE_AGENT_TOOLS,
  createToolAllowlistMiddleware,
} from "./tool-allowlist.js";

export function buildAnalyzeAgent({
  model,
  researchDir,
}: {
  model: ChatOllama;
  researchDir: string;
}) {
  return createDeepAgent({
    model,
    // virtualMode: the system prompt has the agent address files as absolute
    // paths (/report.md, /notes/*.md). Without this, FilesystemBackend passes
    // absolute paths through as real filesystem paths, escaping researchDir
    // entirely. See the same fix in research-agent.ts.
    backend: new FilesystemBackend({ rootDir: researchDir, virtualMode: true }),
    systemPrompt: ANALYZE_SYSTEM_PROMPT,
    middleware: [
      createStringifyToolContentMiddleware(),
      createToolAllowlistMiddleware({ allowedTools: ANALYZE_AGENT_TOOLS }),
    ],
  });
}
