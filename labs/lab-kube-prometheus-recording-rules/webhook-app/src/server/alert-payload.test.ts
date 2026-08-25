import { describe, expect, it } from "vitest";
import type { AlertSummary } from "./alert-payload.js";
import { summarizeAlerts } from "./alert-payload.js";

const grafanaPayload = {
  receiver: "webhook-app",
  status: "firing",
  alerts: [
    {
      status: "firing",
      labels: { alertname: "LabNodeCpuHigh", node: "lab-kps-worker" },
      annotations: {
        summary: "Node lab-kps-worker CPU utilization above 80%.",
      },
    },
    {
      status: "resolved",
      labels: {
        alertname: "LabPodMemHigh",
        namespace: "faults",
        pod: "mem-hog-abc",
      },
      annotations: {},
    },
  ],
};

describe("summarizeAlerts", () => {
  it("returns one summary per alert with alertname, status and labels", () => {
    const summaries: AlertSummary[] = summarizeAlerts(grafanaPayload);
    expect(summaries).toEqual([
      {
        alertname: "LabNodeCpuHigh",
        status: "firing",
        labels: { alertname: "LabNodeCpuHigh", node: "lab-kps-worker" },
      },
      {
        alertname: "LabPodMemHigh",
        status: "resolved",
        labels: {
          alertname: "LabPodMemHigh",
          namespace: "faults",
          pod: "mem-hog-abc",
        },
      },
    ]);
  });

  it("throws on a payload without an alerts array", () => {
    expect(() => summarizeAlerts({ status: "firing" })).toThrow(/alerts/);
  });

  it("defaults alertname when labels omit it", () => {
    const summaries = summarizeAlerts({
      alerts: [{ status: "firing", labels: {} }],
    });
    expect(summaries[0]?.alertname).toBe("unknown");
  });
});
