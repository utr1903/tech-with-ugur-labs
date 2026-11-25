import type {
  ActionKind,
  ActionProposal,
  ActionRequest,
} from "../shared/actions.js";
import type { Verdict } from "../shared/verdict.js";

export function makeVerdict(over: Partial<Verdict> = {}): Verdict {
  return {
    verdict: "malicious",
    confidence: 0.9,
    summary: "A pod read a service account token and listed secrets.",
    attack_techniques: [],
    timeline: [],
    affected: [],
    injection_suspected: false,
    proposal_ids: [],
    ...over,
  };
}

export function makeProposal(
  id: string,
  kind: ActionKind,
  target: ActionProposal["target"],
): ActionProposal {
  return { id, kind, target, reason: "test" };
}

/** One verdict that lists every proposal id, the way the agent builds it. */
export function makeRequest(
  proposals: ActionProposal[],
  verdict: Partial<Verdict> = {},
): ActionRequest {
  return {
    investigationId: "inv-1",
    items: [
      {
        verdict: makeVerdict({
          proposal_ids: proposals.map((p) => p.id),
          ...verdict,
        }),
        proposals,
      },
    ],
  };
}

export function quarantine(id: string, namespace: string, name = "pod-a") {
  return makeProposal(id, "quarantine_pod", { namespace, name });
}
