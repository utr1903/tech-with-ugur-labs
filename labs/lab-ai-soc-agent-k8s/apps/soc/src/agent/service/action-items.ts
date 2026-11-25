import type { ActionItem, ActionProposal } from "../../shared/actions.js";
import type { LoopResult } from "../loop/investigate.js";

/**
 * Investigate mode: the single verdict covers every proposal, so its
 * proposal_ids list them all. Hunt mode: each verdict carries exactly the
 * proposals it lists; proposals no verdict lists ride with the first verdict
 * without being linked, so the responder rejects them visibly.
 */
export function buildActionItems(
  mode: "investigate" | "hunt",
  result: LoopResult,
): ActionItem[] {
  const [first, ...rest] = result.verdicts;
  if (!first) return [];
  if (mode === "investigate") {
    const ids = result.proposals.map((p) => p.id);
    return [
      { verdict: { ...first, proposal_ids: ids }, proposals: result.proposals },
      ...rest.map((verdict) => ({ verdict, proposals: [] })),
    ];
  }
  const claimed = new Set<string>();
  const items: ActionItem[] = result.verdicts.map((verdict) => {
    const proposals: ActionProposal[] = [];
    for (const p of result.proposals) {
      if (verdict.proposal_ids.includes(p.id) && !claimed.has(p.id)) {
        claimed.add(p.id);
        proposals.push(p);
      }
    }
    return { verdict, proposals };
  });
  const unlinked = result.proposals.filter((p) => !claimed.has(p.id));
  const head = items[0];
  if (head) head.proposals = [...head.proposals, ...unlinked];
  return items;
}
