import { describe, expect, it } from "vitest";
import { systemPrompt } from "./prompt.js";

describe("systemPrompt", () => {
  it("pins today's date", () => {
    expect(systemPrompt("2026-11-25", "investigate")).toContain("2026-11-25");
  });

  it("states the untrusted-data rule and the injection fields", () => {
    const p = systemPrompt("2026-11-25", "investigate");
    expect(p).toContain("untrusted");
    expect(p).toContain("injection_suspected");
    expect(p).toContain("injection_evidence");
  });

  it("describes the tenants' normal behaviour", () => {
    const p = systemPrompt("2026-11-25", "investigate");
    for (const fact of [
      "sh -c curl",
      "report_reader",
      "02:00",
      "kubectl exec",
      "ci_migrator",
    ]) {
      expect(p).toContain(fact);
    }
  });

  it("tells the model it cannot execute and what the responder does", () => {
    const p = systemPrompt("2026-11-25", "investigate");
    expect(p).toContain("cannot execute");
    expect(p).toContain("0.8");
    expect(p).toContain("MITRE ATT&CK");
  });

  it("differs per mode in verdict cardinality and adds the hunt brief", () => {
    const inv = systemPrompt("2026-11-25", "investigate");
    const hunt = systemPrompt("2026-11-25", "hunt");
    expect(inv).toContain("exactly once");
    expect(inv).not.toContain("hunt brief");
    expect(hunt).toContain("once per finding");
    expect(hunt).toContain("RoleBinding");
    expect(hunt).toContain("DaemonSet");
  });
});
