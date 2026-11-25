import type { ActionOutcome } from "../shared/actions.js";
import type { Approval } from "./approvals.js";
import type { ResponderDeps } from "./deps.js";
import { checkTarget } from "./policy.js";
import { runAction } from "./run-action.js";

/**
 * Resolve a pending approval. The approval record is marked first, so a
 * second click can never execute twice. On approve the target is
 * re-checked against the CURRENT policy: an approval created before a
 * config change must not bypass the deny-list.
 */
export async function resolveApproval(
  deps: ResponderDeps,
  id: string,
  decision: "approved" | "denied",
): Promise<{ approval: Approval; outcome?: ActionOutcome }> {
  const { logger } = deps;
  logger.info({ approvalId: id, decision }, "Resolving approval...");
  const blocked = decision === "approved";
  const pending = (await deps.approvals.list()).find((a) => a.id === id);
  const violation =
    pending && blocked ? checkTarget(pending.proposal, deps.policy) : undefined;
  const approval = await deps.approvals.resolve(
    id,
    violation ? "denied" : decision,
  );
  await deps.audit.append({
    event: "approval_resolved",
    approvalId: id,
    investigationId: approval.investigationId,
    proposal: approval.proposal,
    state: approval.state,
    ...(violation ? { note: `rejected at approval time: ${violation}` } : {}),
  });
  logger.info(
    { approvalId: id, state: approval.state },
    "Resolving approval succeeded.",
  );
  if (violation) {
    return {
      approval,
      outcome: {
        proposal: approval.proposal,
        status: "rejected",
        reason: violation,
      },
    };
  }
  if (decision === "denied") return { approval };
  const outcome = await runAction(
    deps,
    approval.investigationId,
    approval.proposal,
    "approval",
  );
  return { approval, outcome };
}
