import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ActionProposal } from "../../shared/actions.js";
import type { Verdict } from "../../shared/verdict.js";
import { buildTools } from "../tools/index.js";
import type { InvestigationState, ToolDeps } from "../tools/types.js";
import { type Consumed, consume } from "./consume.js";
import { systemPrompt } from "./prompt.js";
import {
  buildParams,
  MODEL,
  REMINDER,
  REMINDER_ITERATIONS,
  type RunInput,
  type RunnerFactory,
  taskMessage,
} from "./request.js";
import { emptyUsage, type Usage } from "./usage.js";

export type { RunInput, RunnerFactory } from "./request.js";

export type LoopResult = {
  verdicts: Verdict[];
  proposals: ActionProposal[];
  usage: Usage;
  stopReason: string;
  budgetExhausted: boolean;
  model: string;
};

export type LoopDeps = ToolDeps & {
  createRunner: RunnerFactory;
  tokenBudget: number;
  maxIterations: number;
};

function inconclusive(summary: string): Verdict {
  return {
    verdict: "inconclusive",
    confidence: 0,
    summary,
    attack_techniques: [],
    timeline: [],
    affected: [],
    injection_suspected: false,
    proposal_ids: [],
  };
}

function whyNoVerdict(c: Consumed): string {
  if (c.budgetExhausted) return "Token budget exhausted before a verdict.";
  if (c.last?.stop_reason === "refusal") {
    const category = c.last.stop_details?.category;
    return `The model refused to continue${category ? ` (${category})` : ""}; no verdict.`;
  }
  return "The model finished without submitting a verdict.";
}

/** History to continue from: the first runner's messages plus its last reply. */
function reminderMessages(
  first: BetaMessageParam,
  c: Consumed,
  history: BetaMessageParam[] | undefined,
): BetaMessageParam[] {
  const messages = [...(history ?? [first])];
  if (c.last && messages.at(-1)?.role !== "assistant") {
    messages.push({ role: "assistant", content: c.last.content });
  }
  return [...messages, { role: "user", content: REMINDER }];
}

export async function runInvestigation(
  input: RunInput,
  deps: LoopDeps,
): Promise<LoopResult> {
  const { logger } = deps;
  const state: InvestigationState = {
    proposals: [],
    verdicts: [],
    mode: input.mode,
  };
  const tools = buildTools({ ...deps, alerts: input.alerts }, state);
  const today = deps.now().toISOString().slice(0, 10);
  const system = systemPrompt(today, input.mode, input.huntWindowMinutes);
  const first = taskMessage(input);
  logger.info(
    { mode: input.mode, alerts: input.alerts.length },
    "Investigation...",
  );

  const runner = deps.createRunner(
    buildParams({
      system,
      tools,
      messages: [first],
      maxIterations: deps.maxIterations,
    }),
  );
  let done = await consume(runner, emptyUsage(), deps.tokenBudget, logger);
  const refused = done.last?.stop_reason === "refusal";

  if (
    input.mode === "investigate" &&
    state.verdicts.length === 0 &&
    !refused &&
    !done.budgetExhausted
  ) {
    logger.warn({}, "No verdict submitted; sending one reminder.");
    const reminder = deps.createRunner(
      buildParams({
        system,
        tools,
        messages: reminderMessages(first, done, runner.params?.messages),
        maxIterations: REMINDER_ITERATIONS,
      }),
    );
    const again = await consume(reminder, done.usage, deps.tokenBudget, logger);
    done = { ...again, last: again.last ?? done.last };
  }

  if (state.verdicts.length === 0) {
    state.verdicts.push(inconclusive(whyNoVerdict(done)));
  }
  const result: LoopResult = {
    verdicts: state.verdicts,
    proposals: state.proposals,
    usage: done.usage,
    stopReason: done.last?.stop_reason ?? "none",
    budgetExhausted: done.budgetExhausted,
    model: MODEL,
  };
  logger.info(
    {
      verdicts: result.verdicts.length,
      stopReason: result.stopReason,
      budgetExhausted: result.budgetExhausted,
      usage: result.usage,
    },
    "Investigation succeeded.",
  );
  return result;
}
