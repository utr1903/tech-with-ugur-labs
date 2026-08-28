import { AIMessage, ToolMessage } from "langchain";
import { type BuildAgentDeps, buildAgent } from "./build-agent.js";
import type { AgentConfig } from "./config.js";
import { naivePerToolScan, type ScanResult } from "./guard/naive-scanner.js";
import { quarantineTools } from "./guard/quarantine.js";
import type { Logger } from "./logger.js";
import type { McpToolset } from "./mcp-tools.js";

export interface RunResult {
  output: string;
  toolsCalled: string[];
  naiveScan: ScanResult;
}

export interface RunAgentTaskDeps {
  config: AgentConfig;
  logger: Logger;
  model: BuildAgentDeps["model"];
  toolset: McpToolset;
  readFileTool: BuildAgentDeps["tools"][number];
}

// Only tool messages that carry a `name` were actually executed: the
// guardrail's egress-denied stub (guard/guardrail-middleware.ts) builds its
// ToolMessage without one, on purpose, so a denied call never counts here
// even though the model still requested it.
function extractToolsCalled(messages: readonly unknown[]): string[] {
  return messages
    .filter((message): message is ToolMessage => message instanceof ToolMessage)
    .map((message) => message.name)
    .filter((name): name is string => Boolean(name));
}

function extractOutput(messages: readonly unknown[]): string {
  const lastAiMessage = [...messages]
    .reverse()
    .find((message): message is AIMessage => message instanceof AIMessage);
  const content = lastAiMessage?.content;
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
}

// Runs one agent task end to end: reports what the naive per-tool scanner
// would have seen (for the comparison this lab is about), then actually
// drives the agent - with or without the guardrail middleware, per
// config.guard - and reports which tools ran and the final answer.
export async function runAgentTask(
  deps: RunAgentTaskDeps,
  task: string,
): Promise<RunResult> {
  const { config, logger, model, toolset, readFileTool } = deps;

  const naiveScan = naivePerToolScan(
    toolset.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
    })),
  );

  const startedAt = Date.now();
  logger.info(
    { guard: config.guard, task, naiveScan },
    "Running agent task...",
  );
  try {
    // Guard on: quarantine any poisoned tool descriptions BEFORE the model
    // sees them (the framework forbids doing this from a middleware hook).
    // The guardrail middleware added by buildAgent then enforces the egress
    // allowlist as the second layer of defense.
    const baseTools = [readFileTool, ...toolset.tools];
    const agentTools = config.guard
      ? quarantineTools(baseTools, logger)
      : baseTools;
    const agent = buildAgent({
      model,
      tools: agentTools,
      guard: config.guard,
      logger,
    });

    const result = await agent.invoke({
      messages: [{ role: "user", content: task }],
    });
    const messages = result.messages as unknown[];

    const toolsCalled = extractToolsCalled(messages);
    const output = extractOutput(messages);

    logger.info(
      { durationMs: Date.now() - startedAt, toolsCalled },
      "Running agent task succeeded.",
    );
    return { output, toolsCalled, naiveScan };
  } catch (err) {
    logger.error(
      { err, durationMs: Date.now() - startedAt },
      "Running agent task failed.",
    );
    throw err;
  }
}
