import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { Capabilities } from "./capabilities.js";
import type { ExecuteClient, ExecuteOutcome } from "./execute-client.js";
import { describeCodeExecutor } from "./tool-description.js";

const CODE_EXECUTOR_TOOL_NAME = "code_executor";

function toToolContent(outcome: ExecuteOutcome): Record<string, unknown> {
  switch (outcome.kind) {
    case "executed":
      return outcome.execution;
    case "busy":
      return {
        error: "sandbox_busy",
        message:
          "All sandbox execution slots are in use. Retry once; if it is still busy, tell the user.",
      };
    case "rejected":
      return { error: "sandbox_rejected_code", message: outcome.message };
    case "unreachable":
      return { error: "sandbox_unreachable", message: outcome.message };
  }
}

export function createCodeExecutorTool({
  capabilities,
  client,
}: {
  capabilities: Capabilities;
  client: ExecuteClient;
}) {
  return new DynamicStructuredTool({
    name: CODE_EXECUTOR_TOOL_NAME,
    description: describeCodeExecutor(capabilities),
    schema: z.object({
      code: z
        .string()
        .min(1)
        .max(capabilities.limits.maxCodeBytes)
        .describe(
          "A complete, self-contained Python 3 program. Print what you want to read back and write structured results to result.json.",
        ),
    }),
    func: async ({ code }) =>
      JSON.stringify(toToolContent(await client.execute(code))),
  });
}
