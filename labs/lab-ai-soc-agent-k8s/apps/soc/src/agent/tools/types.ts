import type { Logger } from "../../logger.js";
import type { ActionProposal } from "../../shared/actions.js";
import type { Verdict } from "../../shared/verdict.js";
import type { K8sReader, SecretMetadataClient } from "./k8s-get.js";
import type { LokiClient } from "./loki-client.js";

export type AlertContext = {
  fingerprint: string;
  alertname: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt: string;
};

export type InvestigationState = {
  proposals: ActionProposal[];
  verdicts: Verdict[];
  mode: "investigate" | "hunt";
};

export type ToolDeps = {
  loki: LokiClient;
  k8s: K8sReader;
  secrets: SecretMetadataClient;
  alerts: AlertContext[];
  logger: Logger;
  now: () => Date;
};
