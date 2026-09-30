import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { MemorySaver } from "@langchain/langgraph";
import { type CreateDeepAgentParams, createDeepAgent } from "deepagents";
import { todoListMiddleware, toolStrategy } from "langchain";
import type { Logger } from "../logger.js";
import { createAgentGate } from "./agent-gate.js";
import { researchPrompt } from "./agent-prompt.js";
import { emptyDraft, evaluateDraft, researchResult } from "./agent-result.js";
import { agentTools } from "./agent-tools.js";
import type { ResearchTools } from "./firecrawl-types.js";
import type { ResearchRequest } from "./input.js";
import {
  type CoverageRecord,
  reportDraftSchema,
  validateDraft,
} from "./report.js";

export interface RunResult {
  report: string;
  coverage: CoverageRecord;
  exitCode: 0 | 1;
}
export async function runResearch(
  request: ResearchRequest,
  tools: ResearchTools,
  model: BaseChatModel,
  logger: Logger,
): Promise<RunResult> {
  logger.info(
    { requestedCount: request.requestedUrls.length },
    "Researching URLs...",
  );
  const controller = new AbortController();
  const gate = createAgentGate(tools, logger, controller.signal);
  const agent = createDeepAgent({
    model,
    tools: agentTools(request, tools),
    systemPrompt: researchPrompt,
    // LangChain's todo tool uses Zod 3 types; the runtime accepts it with this strict TS bridge.
    middleware: [
      todoListMiddleware(),
      gate.middleware,
    ] as unknown as NonNullable<CreateDeepAgentParams["middleware"]>,
    responseFormat: toolStrategy(
      reportDraftSchema.meta({ title: "report_draft" }),
      { handleError: false },
    ),
    checkpointer: new MemorySaver(),
  });
  const config = {
    configurable: { thread_id: crypto.randomUUID() },
    recursionLimit: 120,
    signal: controller.signal,
  };
  let draft = emptyDraft("The research run did not produce a valid draft.");
  let feedback = validateDraft(draft, tools.snapshot(), request);
  let content = JSON.stringify({
    instruction: request.instruction,
    suppliedUrls: request.requestedUrls.map(({ url }) => url),
    invalidInputCount: request.invalidEntries.length,
    limits: tools.snapshot().limits,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("time-budget"));
    }, tools.snapshot().limits.maxDurationMs);
  });
  try {
    for (let round = 0; round <= 2; round += 1) {
      const state = await Promise.race([
        agent.invoke({ messages: [{ role: "user", content }] }, config),
        timeout,
      ]);
      ({ draft, feedback } = evaluateDraft(
        state.structuredResponse,
        tools.snapshot(),
        request,
        gate.hasPlan(),
      ));
      logger.info(
        {
          round,
          status: feedback.status,
          reasonCount: feedback.reasons.length,
        },
        "Validating research draft succeeded.",
      );
      if (!feedback.repairPossible || round === 2) break;
      gate.requireRevision();
      content = `Validation feedback. Revise write_todos first, repair the specific gaps, and return a corrected report_draft. ${JSON.stringify(feedback)}`;
    }
  } catch (err) {
    const reason = controller.signal.aborted
      ? "time-budget"
      : "agent-provider-error";
    tools.record({
      kind: reason === "time-budget" ? "cap" : "failure",
      operation: "research",
      reason,
    });
    logger.error({ err: new Error(reason) }, "Researching URLs failed.");
    draft.knownOmissions.push({
      reason:
        "Research stopped before a validated final draft could be completed.",
      impact: "blocking",
    });
    feedback = validateDraft(draft, tools.snapshot(), request);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
  const snapshot = tools.snapshot();
  const result = researchResult(draft, snapshot, feedback);
  logger.info(
    { status: result.coverage.status, exitCode: result.exitCode },
    "Researching URLs succeeded.",
  );
  return result;
}
