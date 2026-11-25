import { z } from "zod";

export const VerdictSchema = z.object({
  verdict: z.enum(["malicious", "benign", "inconclusive"]),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(4000),
  attack_techniques: z
    .array(
      z.object({
        id: z.string().regex(/^T\d{4}(\.\d{3})?$/),
        name: z.string(),
      }),
    )
    .max(20),
  timeline: z
    .array(
      z.object({
        time: z.string(),
        source: z.enum(["audit", "runtime", "app", "db", "k8s", "alert"]),
        event: z.string().max(500),
      }),
    )
    .max(50),
  affected: z
    .array(
      z.object({
        kind: z.string(),
        namespace: z.string().optional(),
        name: z.string(),
      }),
    )
    .max(30),
  injection_suspected: z.boolean(),
  injection_evidence: z.string().max(1000).optional(),
  proposal_ids: z.array(z.string()).max(10),
});

export type Verdict = z.infer<typeof VerdictSchema>;
