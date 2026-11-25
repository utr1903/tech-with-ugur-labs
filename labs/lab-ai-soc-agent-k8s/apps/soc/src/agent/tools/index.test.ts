import { describe, expect, it } from "vitest";
import { buildTools } from "./index.js";
import { makeDeps, makeState } from "./test-support.js";

describe("buildTools", () => {
  it("assembles the tools in the documented order", () => {
    const names = buildTools(makeDeps(), makeState()).map((t) => t.name);
    expect(names).toEqual([
      "get_alert_context",
      "query_logs",
      "k8s_get",
      "quarantine_pod",
      "scale_to_zero",
      "revoke_binding",
      "rotate_secret",
      "submit_verdict",
    ]);
  });
});
