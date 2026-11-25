import type { Logger } from "../../logger.js";
import type { ActionOutcome, ActionProposal } from "../../shared/actions.js";
import type { LoopResult, RunInput } from "../loop/investigate.js";
import { MODEL } from "../loop/request.js";
import { emptyUsage } from "../loop/usage.js";
import type { AlertContext } from "../tools/types.js";
import { buildActionItems } from "./action-items.js";
import type { Report, ReportStore } from "./reports.js";
import type { ResponderClient } from "./responder-client.js";

export type JobDeps = {
  logger: Logger;
  run: (input: RunInput) => Promise<LoopResult>;
  responder: ResponderClient;
  store: ReportStore;
  now: () => Date;
  /** Called when a job ends in an error report, e.g. to re-open its alerts. */
  onError?: (job: Job) => void;
};

export type Job = {
  id: string;
  mode: "investigate" | "hunt";
  alerts: AlertContext[];
  relatedTo?: string;
  huntWindowMinutes?: number;
};

const MAX_SUMMARY = 500;

function errorResult(err: unknown): LoopResult {
  const name = err instanceof Error ? err.constructor.name : typeof err;
  const message = err instanceof Error ? err.message : String(err);
  return {
    verdicts: [
      {
        verdict: "inconclusive",
        confidence: 0,
        summary: `Investigation failed: ${name}: ${message}`.slice(
          0,
          MAX_SUMMARY,
        ),
        attack_techniques: [],
        timeline: [],
        affected: [],
        injection_suspected: false,
        proposal_ids: [],
      },
    ],
    proposals: [],
    usage: emptyUsage(),
    stopReason: "error",
    budgetExhausted: false,
    model: MODEL,
  };
}

async function investigate(deps: JobDeps, job: Job): Promise<LoopResult> {
  const { id, mode, alerts, relatedTo, huntWindowMinutes } = job;
  try {
    return await deps.run({ mode, alerts, relatedTo, huntWindowMinutes });
  } catch (err) {
    deps.logger.error({ err, reportId: id }, "Investigation failed.");
    return errorResult(err);
  }
}

function failedOutcomes(
  proposals: ActionProposal[],
  err: unknown,
): ActionOutcome[] {
  const message = err instanceof Error ? err.message : String(err);
  return proposals.map((proposal) => ({
    proposal,
    status: "failed",
    reason: `Responder request failed: ${message}`.slice(0, 500),
  }));
}

async function sendActions(
  deps: JobDeps,
  job: Job,
  result: LoopResult,
): Promise<ActionOutcome[]> {
  const items = buildActionItems(job.mode, result);
  if (items.length === 0) return [];
  const { logger } = deps;
  try {
    logger.info(
      { reportId: job.id, items: items.length },
      "Sending actions...",
    );
    const outcomes = await deps.responder.send({
      investigationId: job.id,
      items,
    });
    logger.info(
      { reportId: job.id, outcomes: outcomes.length },
      "Sending actions succeeded.",
    );
    return outcomes;
  } catch (err) {
    logger.error({ err, reportId: job.id }, "Sending actions failed.");
    return failedOutcomes(
      items.flatMap((i) => i.proposals),
      err,
    );
  }
}

/** Runs one job to a saved report. Only a failure to save the report throws. */
export async function runJob(deps: JobDeps, job: Job): Promise<void> {
  const { logger, store } = deps;
  const createdAt = deps.now().toISOString();
  logger.info({ reportId: job.id, mode: job.mode }, "Running job...");
  const result = await investigate(deps, job);
  if (result.stopReason === "error") deps.onError?.(job);
  const outcomes =
    result.stopReason === "error" ? [] : await sendActions(deps, job, result);
  const report: Report = {
    id: job.id,
    mode: job.mode,
    createdAt,
    finishedAt: deps.now().toISOString(),
    alerts: job.alerts,
    ...(job.relatedTo ? { relatedTo: job.relatedTo } : {}),
    verdicts: result.verdicts,
    proposals: result.proposals,
    outcomes,
    usage: result.usage,
    stopReason: result.stopReason,
    budgetExhausted: result.budgetExhausted,
    model: result.model,
  };
  try {
    await store.save(report);
    logger.info({ reportId: job.id }, "Running job succeeded.");
  } catch (err) {
    logger.error({ err, reportId: job.id }, "Saving report failed.");
    throw err;
  }
}
