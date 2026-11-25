import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { buildAlertContext } from "./alert-context.js";
import { buildK8sGet } from "./k8s-get.js";
import { buildProposalTools } from "./proposals.js";
import { buildQueryLogs } from "./query-logs.js";
import { buildSubmitVerdict } from "./submit-verdict.js";
import type { InvestigationState, ToolDeps } from "./types.js";

export type { BetaRunnableTool };

/** Read tools first, then the four proposal tools, then the verdict. */
export function buildTools(
  deps: ToolDeps,
  state: InvestigationState,
): BetaRunnableTool[] {
  return [
    buildAlertContext(deps),
    buildQueryLogs(deps),
    buildK8sGet(deps),
    ...buildProposalTools(deps, state),
    buildSubmitVerdict(deps, state),
  ];
}
