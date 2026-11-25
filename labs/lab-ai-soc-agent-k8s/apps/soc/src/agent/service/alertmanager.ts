import { z } from "zod";
import type { AlertContext } from "../tools/types.js";

const AlertSchema = z.object({
  status: z.string(),
  labels: z.record(z.string(), z.string()),
  annotations: z.record(z.string(), z.string()).default({}),
  startsAt: z.string(),
  fingerprint: z.string().min(1).max(200),
});

const PayloadSchema = z.object({
  version: z.string(),
  alerts: z.array(AlertSchema).max(100),
});

/** Parses an Alertmanager v4 webhook body; resolved alerts are dropped. Throws on a malformed body. */
export function parseAlertmanagerPayload(body: unknown): AlertContext[] {
  return PayloadSchema.parse(body)
    .alerts.filter((a) => a.status === "firing")
    .map((a) => ({
      fingerprint: a.fingerprint,
      alertname: a.labels.alertname ?? "unknown",
      labels: a.labels,
      annotations: a.annotations,
      startsAt: a.startsAt,
    }));
}
