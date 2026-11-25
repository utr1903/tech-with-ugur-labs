import { z } from "zod";
import { type Verdict, VerdictSchema } from "./verdict.js";

export type ActionKind =
  | "quarantine_pod"
  | "scale_to_zero"
  | "revoke_binding"
  | "rotate_secret";

/** Reversible, narrow actions the responder may run on its own. */
export const CONTAINMENT: ReadonlySet<ActionKind> = new Set<ActionKind>([
  "quarantine_pod",
  "scale_to_zero",
]);

/** Actions that remove access or change credentials: a human decides. */
export const DESTRUCTIVE: ReadonlySet<ActionKind> = new Set<ActionKind>([
  "revoke_binding",
  "rotate_secret",
]);

type ActionTarget = {
  namespace?: string;
  name: string;
  resource?:
    | "deployment"
    | "statefulset"
    | "rolebinding"
    | "clusterrolebinding";
};

export type ActionProposal = {
  id: string;
  kind: ActionKind;
  target: ActionTarget;
  reason: string;
};

export type ActionItem = { verdict: Verdict; proposals: ActionProposal[] };
export type ActionRequest = { investigationId: string; items: ActionItem[] };

type ActionStatus = "executed" | "pending_approval" | "rejected" | "failed";

export type ActionOutcome = {
  proposal: ActionProposal;
  status: ActionStatus;
  reason: string;
  approvalId?: string;
};

const ProposalSchema = z.object({
  id: z.string().min(1).max(100),
  // Deliberately any string: an unknown kind must reach the policy and be
  // rejected there, per proposal, with an audit entry, not fail the request.
  kind: z.custom<ActionKind>((v) => typeof v === "string"),
  target: z.object({
    namespace: z.string().max(253).optional(),
    name: z.string().max(253),
    resource: z
      .enum(["deployment", "statefulset", "rolebinding", "clusterrolebinding"])
      .optional(),
  }),
  reason: z.string().max(1000),
});

export const ActionRequestSchema = z.object({
  investigationId: z.string().min(1).max(200),
  items: z
    .array(
      z.object({
        verdict: VerdictSchema,
        proposals: z.array(ProposalSchema).max(50),
      }),
    )
    .max(20),
});
