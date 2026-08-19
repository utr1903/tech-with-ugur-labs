import { describe, expect, it } from "vitest";
import { buildLookupCommand, runLookup } from "./lookup.js";

describe("buildLookupCommand", () => {
  // DELIBERATELY VULNERABLE: host is concatenated into a shell command.
  it("concatenates the host into the shell command", () => {
    expect(buildLookupCommand("example.com")).toContain("example.com");
  });
});

describe("runLookup", () => {
  it("executes injected commands via the shell (RCE)", async () => {
    const out = await runLookup("127.0.0.1; echo INJECTED-1234");
    expect(out).toContain("INJECTED-1234");
  });
});
