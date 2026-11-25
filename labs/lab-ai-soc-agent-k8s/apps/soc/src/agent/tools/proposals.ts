import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ActionKind, ActionTarget } from "../../shared/actions.js";
import { runLogged, ToolFailure } from "./tool-run.js";
import type { InvestigationState, ToolDeps } from "./types.js";

const NOTE =
  "Recorded. Nothing executes until you submit the verdict; the responder applies policy.";

const RULES = `Nothing executes now: this only records a proposal, which takes effect after you submit your verdict and only if the responder's policy allows it. Targets in kube-system, soc, observability and other platform namespaces are refused.`;

const BASE_FIELDS = {
  name: z.string().min(1).max(253).describe("Exact name of the target object."),
  reason: z
    .string()
    .min(10)
    .max(500)
    .describe("Evidence-based justification, citing what you observed."),
};

const namespaceField = z
  .string()
  .max(253)
  .optional()
  .describe(
    "Namespace of the target (required except for cluster role bindings).",
  );

type Spec = {
  kind: ActionKind;
  summary: string;
  useFor: string;
  doNotUse: string;
  resource?: z.ZodType<NonNullable<ActionTarget["resource"]>>;
};

const SPECS: Spec[] = [
  {
    kind: "quarantine_pod",
    summary:
      "Propose isolating one pod with a deny-all network policy. Reversible; may run automatically once policy allows.",
    useFor:
      "a pod that is clearly compromised and talking to attacker infrastructure.",
    doNotUse:
      "stopping a whole workload (use scale_to_zero) or for pods you only suspect.",
  },
  {
    kind: "scale_to_zero",
    summary:
      "Propose scaling a Deployment or StatefulSet to zero replicas. Reversible; may run automatically once policy allows.",
    useFor: "a workload that keeps re-creating a malicious pod.",
    doNotUse:
      "isolating a single pod (use quarantine_pod) or for anything you have not confirmed.",
    resource: z.enum(["deployment", "statefulset"]),
  },
  {
    kind: "revoke_binding",
    summary:
      "Propose deleting a RoleBinding or ClusterRoleBinding. It always needs a human to approve.",
    useFor: "a binding an attacker created or abused to gain access.",
    doNotUse:
      "bindings you have not inspected with k8s_get, or to fix ordinary misconfiguration.",
    resource: z.enum(["rolebinding", "clusterrolebinding"]),
  },
  {
    kind: "rotate_secret",
    summary:
      "Propose rotating a Secret's credentials. It always needs a human to approve.",
    useFor:
      "a secret whose key names show it was read by an untrusted workload.",
    doNotUse: "secrets with no evidence of exposure.",
  },
];

function describeSpec(s: Spec): string {
  const needsHuman =
    s.kind === "revoke_binding" || s.kind === "rotate_secret"
      ? ` ${s.kind} always needs a human to approve, even when you are certain.`
      : "";
  return `${s.summary} ${RULES}${needsHuman}\nUse for: ${s.useFor}\nDo NOT use for: ${s.doNotUse}`;
}

type Args = {
  namespace?: string;
  name: string;
  resource?: ActionTarget["resource"];
  reason: string;
};

function schemaFor(s: Spec): z.ZodType<Args> {
  const base = { namespace: namespaceField, ...BASE_FIELDS };
  if (!s.resource) return z.object(base);
  return z.object({
    ...base,
    resource: s.resource.describe("Kind of the target object."),
  });
}

function record(state: InvestigationState, kind: ActionKind, a: Args): string {
  if (!a.namespace && a.resource !== "clusterrolebinding") {
    throw new ToolFailure(
      "namespace_required",
      `${kind} needs a namespace for this target.`,
    );
  }
  const target: ActionTarget = { name: a.name };
  if (a.namespace) target.namespace = a.namespace;
  if (a.resource) target.resource = a.resource;
  const id = `p${state.proposals.length + 1}`;
  state.proposals.push({ id, kind, target, reason: a.reason });
  return JSON.stringify({ proposal_id: id, note: NOTE });
}

export function buildProposalTools(deps: ToolDeps, state: InvestigationState) {
  return SPECS.map((s) =>
    betaZodTool({
      name: s.kind,
      description: describeSpec(s),
      inputSchema: schemaFor(s),
      run: (args: Args) =>
        runLogged(deps.logger, s.kind, args, async () =>
          record(state, s.kind, args),
        ),
    }),
  );
}
