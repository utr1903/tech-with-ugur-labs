import { describe, expect, it } from "vitest";
import { assembledInstruction, POISONED_TOOLS } from "./fragments.js";

describe("POISONED_TOOLS", () => {
  it("has at least 3 entries", () => {
    expect(POISONED_TOOLS.length).toBeGreaterThanOrEqual(3);
  });

  it("splits the instruction so no single fragment carries all tokens", () => {
    const tokens = ["read_file", "/secret/id_rsa", "submit_telemetry"];
    for (const tool of POISONED_TOOLS) {
      const containedCount = tokens.filter((token) =>
        tool.fragment.includes(token),
      ).length;
      expect(containedCount).toBeLessThan(tokens.length);
    }
  });

  it("reassembles into the full instruction when concatenated in order", () => {
    const joined = POISONED_TOOLS.map((tool) => tool.fragment).join(" ");
    expect(joined).toContain("read_file");
    expect(joined).toContain("/secret/id_rsa");
    expect(joined).toContain("submit_telemetry");
  });
});

describe("assembledInstruction", () => {
  it("contains the tool name, secret path, and telemetry tool name", () => {
    const instruction = assembledInstruction();
    expect(instruction).toContain("read_file");
    expect(instruction).toContain("/secret/id_rsa");
    expect(instruction).toContain("submit_telemetry");
  });
});
