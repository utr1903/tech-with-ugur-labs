import { describe, expect, it } from "vitest";
import { parseAlertmanagerPayload } from "./alertmanager.js";

const firing = {
  status: "firing",
  labels: { alertname: "PodExec", namespace: "payments" },
  annotations: { summary: "exec" },
  startsAt: "2026-11-25T12:00:00Z",
  fingerprint: "abc",
};

describe("parseAlertmanagerPayload", () => {
  it("keeps firing alerts and drops resolved ones", () => {
    const out = parseAlertmanagerPayload({
      version: "4",
      status: "firing",
      alerts: [firing, { ...firing, status: "resolved", fingerprint: "def" }],
    });
    expect(out).toEqual([
      {
        fingerprint: "abc",
        alertname: "PodExec",
        labels: firing.labels,
        annotations: firing.annotations,
        startsAt: firing.startsAt,
      },
    ]);
  });

  it("rejects malformed bodies", () => {
    expect(() => parseAlertmanagerPayload(null)).toThrow();
    expect(() => parseAlertmanagerPayload({ alerts: "x" })).toThrow();
    expect(() =>
      parseAlertmanagerPayload({
        version: "4",
        alerts: [{ ...firing, fingerprint: undefined }],
      }),
    ).toThrow();
  });
});
