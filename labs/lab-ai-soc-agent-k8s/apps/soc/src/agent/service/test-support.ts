import { createLogger } from "../../logger.js";
import type { ActionProposal } from "../../shared/actions.js";
import type { Verdict } from "../../shared/verdict.js";
import type { LoopResult } from "../loop/investigate.js";
import { emptyUsage } from "../loop/usage.js";
import type { AlertContext } from "../tools/types.js";
import type { Report } from "./reports.js";

export const logger = createLogger({ appName: "service-test" });

export function alert(fingerprint: string): AlertContext {
  return {
    fingerprint,
    alertname: "PodExec",
    labels: { alertname: "PodExec", namespace: "payments" },
    annotations: {},
    startsAt: "2026-11-25T12:00:00Z",
  };
}

export function verdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    verdict: "malicious",
    confidence: 0.9,
    summary: "Attacker exec'd into the pod.",
    attack_techniques: [{ id: "T1609", name: "Container Administration" }],
    timeline: [
      { time: "2026-11-25T12:00:00Z", source: "audit", event: "exec" },
    ],
    affected: [{ kind: "pod", namespace: "payments", name: "api-1" }],
    injection_suspected: false,
    proposal_ids: [],
    ...overrides,
  };
}

export function proposal(id: string): ActionProposal {
  return {
    id,
    kind: "quarantine_pod",
    target: { namespace: "payments", name: "api-1" },
    reason: "Contain it.",
  };
}

export function loopResult(overrides: Partial<LoopResult> = {}): LoopResult {
  return {
    verdicts: [verdict()],
    proposals: [],
    usage: emptyUsage(),
    stopReason: "end_turn",
    budgetExhausted: false,
    model: "claude-opus-5-5",
    ...overrides,
  };
}

export function report(id: string, overrides: Partial<Report> = {}): Report {
  return {
    id,
    mode: "investigate",
    createdAt: "2026-11-25T12:00:00.000Z",
    finishedAt: "2026-11-25T12:01:00.000Z",
    alerts: [alert("fp1")],
    verdicts: [verdict()],
    proposals: [],
    outcomes: [],
    usage: emptyUsage(),
    stopReason: "end_turn",
    budgetExhausted: false,
    model: "claude-opus-5-5",
    ...overrides,
  };
}
