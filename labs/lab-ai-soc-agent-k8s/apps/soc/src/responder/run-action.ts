import type { ActionOutcome, ActionProposal } from "../shared/actions.js";
import type { ResponderDeps } from "./deps.js";

/**
 * Execute one proposal that policy has cleared. Failures become a
 * `failed` outcome and an audit entry; nothing is thrown to the caller.
 */
export async function runAction(
  deps: Pick<ResponderDeps, "executor" | "audit" | "logger">,
  investigationId: string,
  proposal: ActionProposal,
  via: "policy" | "approval",
): Promise<ActionOutcome> {
  const fields = { investigationId, proposalId: proposal.id, via };
  try {
    deps.logger.info(fields, "Running action...");
    await deps.executor.execute(proposal);
    deps.logger.info(fields, "Running action succeeded.");
    await deps.audit.append({
      event: "execution_result",
      ...fields,
      proposal,
      status: "executed",
    });
    return { proposal, status: "executed", reason: `executed via ${via}` };
  } catch (err) {
    deps.logger.error({ err, ...fields }, "Running action failed.");
    const reason = err instanceof Error ? err.message : String(err);
    await deps.audit.append({
      event: "execution_result",
      ...fields,
      proposal,
      status: "failed",
      error: reason,
    });
    return { proposal, status: "failed", reason };
  }
}
