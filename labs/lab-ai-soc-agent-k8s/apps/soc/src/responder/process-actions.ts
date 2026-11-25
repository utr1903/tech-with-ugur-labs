import type { ActionOutcome, ActionRequest } from "../shared/actions.js";
import type { ResponderDeps } from "./deps.js";
import { type Decision, decide } from "./policy.js";
import { runAction } from "./run-action.js";

async function applyDecision(
  deps: ResponderDeps,
  investigationId: string,
  d: Decision,
): Promise<ActionOutcome> {
  await deps.audit.append({
    event: "proposal_decision",
    investigationId,
    proposal: d.proposal,
    decision: d.decision,
    reason: d.reason,
  });
  if (d.decision === "execute") {
    return runAction(deps, investigationId, d.proposal, "policy");
  }
  if (d.decision === "queue") {
    const approval = await deps.approvals.add(investigationId, d.proposal);
    return {
      proposal: d.proposal,
      status: "pending_approval",
      reason: d.reason,
      approvalId: approval.id,
    };
  }
  return { proposal: d.proposal, status: "rejected", reason: d.reason };
}

/** Policy first, then act on each decision in request order. */
export async function processActions(
  deps: ResponderDeps,
  req: ActionRequest,
): Promise<ActionOutcome[]> {
  const { logger } = deps;
  const fields = { investigationId: req.investigationId };
  logger.info(fields, "Processing action request...");
  const outcomes: ActionOutcome[] = [];
  for (const d of decide(req, deps.policy)) {
    outcomes.push(await applyDecision(deps, req.investigationId, d));
  }
  logger.info(
    { ...fields, count: outcomes.length },
    "Processing action request succeeded.",
  );
  return outcomes;
}
