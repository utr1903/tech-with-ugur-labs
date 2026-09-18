import { describe, expect, it } from "vitest";
import { sampleCapabilities } from "./test-fixtures.js";
import {
  describeCodeExecutor,
  installedModulesLine,
} from "./tool-description.js";

describe("describeCodeExecutor", () => {
  const text = describeCodeExecutor(sampleCapabilities);

  it("says when to use it and when not to", () => {
    expect(text).toMatch(/Use for:/);
    expect(text).toMatch(/Do NOT use for:/);
  });

  it("names exactly the installed modules with versions on one parseable line", () => {
    expect(installedModulesLine(sampleCapabilities)).toBe(
      "Installed modules: numpy (numpy 2.5.3), sklearn (scikit-learn 1.9.1).",
    );
    expect(text).toContain(installedModulesLine(sampleCapabilities));
    expect(text).toContain("Python 3.12.14");
  });

  it("states every limit and the environment facts from the document", () => {
    expect(text).toContain("30 s");
    expect(text).toContain("65536 bytes");
    expect(text).toContain("20 executions");
    expect(text).toContain(sampleCapabilities.network);
    expect(text).toContain(sampleCapabilities.persistence);
    expect(text).toContain(sampleCapabilities.structuredResult);
  });

  it("states the result.json cap from the document's own result limit", () => {
    expect(text).toContain("result.json at most 65536 bytes;");
    const custom = describeCodeExecutor({
      ...sampleCapabilities,
      limits: { ...sampleCapabilities.limits, maxResultBytes: 4096 },
    });
    expect(custom).toContain("result.json at most 4096 bytes;");
  });
});
