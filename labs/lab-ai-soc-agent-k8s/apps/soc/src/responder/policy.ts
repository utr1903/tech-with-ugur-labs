/*
 * Action policy: the guardrails live here, in code, not in the prompt.
 * The agent only proposes; this module decides. Every proposal is
 * evaluated in request order (the position counts across all items)
 * and the FIRST matching step wins:
 *
 *   1. unknown kind                                       -> reject
 *   2. target shape invalid for the kind                  -> reject
 *   3. proposal id not listed in its verdict.proposal_ids -> reject
 *   4. denied namespace or protected binding              -> reject
 *   5. position is past maxActionsPerInvestigation        -> reject
 *   6. destructive kind (revoke_binding, rotate_secret)   -> queue
 *   7. containment kind + verdict malicious + confidence
 *      >= autoContainConfidence (+ no injection suspected)-> execute
 *   8. anything else                                      -> queue
 *
 * Steps 1, 2 and 4 depend only on the proposal itself and are exported
 * as checkTarget, so an approval created before a config change is
 * re-checked at approve time and cannot bypass the deny-list.
 */
import {
  type ActionItem,
  type ActionKind,
  type ActionProposal,
  type ActionRequest,
  CONTAINMENT,
  DESTRUCTIVE,
} from "../shared/actions.js";

export type PolicyConfig = {
  deniedNamespaces: ReadonlySet<string>;
  protectedBindings: readonly RegExp[];
  autoContainConfidence: number;
  maxActionsPerInvestigation: number;
};

export const DEFAULT_POLICY: PolicyConfig = {
  deniedNamespaces: new Set([
    "kube-system",
    "kube-public",
    "kube-node-lease",
    "soc",
    "observability",
    "local-path-storage",
  ]),
  protectedBindings: [/^cluster-admin$/, /^system:/, /^kubeadm:/],
  autoContainConfidence: 0.8,
  maxActionsPerInvestigation: 5,
};

export type Decision = {
  proposal: ActionProposal;
  decision: "execute" | "queue" | "reject";
  reason: string;
};

const KNOWN_KINDS: ReadonlySet<string> = new Set<ActionKind>([
  ...CONTAINMENT,
  ...DESTRUCTIVE,
]);
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const OBJECT_NAME = /^[a-z0-9]([-a-z0-9.:]{0,251}[a-z0-9])?$/;

function kindShapeError(p: ActionProposal): string | undefined {
  const { namespace, resource } = p.target;
  switch (p.kind) {
    case "quarantine_pod":
    case "rotate_secret":
      return !namespace || resource !== undefined
        ? `${p.kind} needs a namespace and no resource`
        : undefined;
    case "scale_to_zero":
      if (!namespace) return "scale_to_zero needs a namespace";
      return resource && resource !== "deployment" && resource !== "statefulset"
        ? "scale_to_zero resource must be deployment or statefulset"
        : undefined;
    case "revoke_binding":
      return (resource === "rolebinding" && namespace) ||
        (resource === "clusterrolebinding" && !namespace)
        ? undefined
        : "revoke_binding needs a rolebinding with a namespace or a clusterrolebinding without one";
  }
}

function targetShapeError(p: ActionProposal): string | undefined {
  const { namespace, name } = p.target;
  if (!OBJECT_NAME.test(name)) return "name is not a valid Kubernetes name";
  if (namespace !== undefined && !DNS_LABEL.test(namespace)) {
    return "namespace is not a valid Kubernetes namespace";
  }
  return kindShapeError(p);
}

function protectedTargetError(
  p: ActionProposal,
  cfg: PolicyConfig,
): string | undefined {
  const { namespace, name } = p.target;
  if (namespace && cfg.deniedNamespaces.has(namespace)) {
    return `namespace ${namespace} is protected`;
  }
  if (
    p.kind === "revoke_binding" &&
    cfg.protectedBindings.some((re) => re.test(name))
  ) {
    return `binding ${name} is protected`;
  }
  return undefined;
}

/** Steps 1 and 2: the proposal is a well-formed request for a known kind. */
function checkWellFormed(p: ActionProposal): string | undefined {
  if (!KNOWN_KINDS.has(p.kind)) return `unknown kind ${String(p.kind)}`;
  const shape = targetShapeError(p);
  return shape ? `invalid target: ${shape}` : undefined;
}

/** Steps 1, 2 and 4: everything that depends on the proposal alone. */
export function checkTarget(
  p: ActionProposal,
  cfg: PolicyConfig,
): string | undefined {
  return checkWellFormed(p) ?? protectedTargetError(p, cfg);
}

function chooseAction(
  p: ActionProposal,
  item: ActionItem,
  cfg: PolicyConfig,
): Pick<Decision, "decision" | "reason"> {
  if (DESTRUCTIVE.has(p.kind)) {
    return { decision: "queue", reason: "destructive action needs approval" };
  }
  const { verdict } = item;
  if (verdict.verdict !== "malicious") {
    return { decision: "queue", reason: "verdict not malicious" };
  }
  if (verdict.confidence < cfg.autoContainConfidence) {
    return {
      decision: "queue",
      reason: `confidence ${verdict.confidence} below auto-containment threshold ${cfg.autoContainConfidence}`,
    };
  }
  if (verdict.injection_suspected) {
    return {
      decision: "queue",
      reason: "prompt injection suspected in the evidence",
    };
  }
  return { decision: "execute", reason: "malicious verdict above threshold" };
}

function reject(p: ActionProposal, reason: string): Decision {
  return { proposal: p, decision: "reject", reason };
}

function decideOne(
  p: ActionProposal,
  item: ActionItem,
  position: number,
  cfg: PolicyConfig,
): Decision {
  const malformed = checkWellFormed(p);
  if (malformed) return reject(p, malformed);
  if (!item.verdict.proposal_ids.includes(p.id)) {
    return reject(p, "not linked to a verdict");
  }
  const protectedTarget = protectedTargetError(p, cfg);
  if (protectedTarget) return reject(p, protectedTarget);
  if (position >= cfg.maxActionsPerInvestigation) {
    return reject(
      p,
      `action limit of ${cfg.maxActionsPerInvestigation} per investigation reached`,
    );
  }
  return { proposal: p, ...chooseAction(p, item, cfg) };
}

export function decide(req: ActionRequest, cfg: PolicyConfig): Decision[] {
  let position = 0;
  return req.items.flatMap((item) =>
    item.proposals.map((p) => decideOne(p, item, position++, cfg)),
  );
}
