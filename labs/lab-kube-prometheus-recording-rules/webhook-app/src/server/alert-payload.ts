export type AlertSummary = {
  alertname: string;
  status: string;
  labels: Record<string, string>;
};

type RawAlert = { status?: unknown; labels?: unknown };

// Grafana webhook payloads follow the Alertmanager shape: { alerts: [...] }.
export function summarizeAlerts(payload: unknown): AlertSummary[] {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !Array.isArray((payload as { alerts?: unknown }).alerts)
  ) {
    throw new Error("Payload has no alerts array.");
  }
  return (payload as { alerts: RawAlert[] }).alerts.map((alert) => {
    const labels =
      typeof alert.labels === "object" && alert.labels !== null
        ? (alert.labels as Record<string, string>)
        : {};
    return {
      alertname: labels.alertname ?? "unknown",
      status: typeof alert.status === "string" ? alert.status : "unknown",
      labels,
    };
  });
}
