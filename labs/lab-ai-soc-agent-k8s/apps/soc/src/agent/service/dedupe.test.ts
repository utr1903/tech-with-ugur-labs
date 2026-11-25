import { describe, expect, it } from "vitest";
import { createDeduper } from "./dedupe.js";
import { alert } from "./test-support.js";

function setup(windowMs = 1000) {
  let t = 0;
  const d = createDeduper(windowMs, () => t);
  return { d, advance: (ms: number) => (t += ms) };
}

describe("createDeduper", () => {
  it("passes unseen alerts through", () => {
    const { d } = setup();
    const r = d.filterNew([alert("a"), alert("b")]);
    expect(r.fresh.map((a) => a.fingerprint)).toEqual(["a", "b"]);
    expect(r.relatedTo).toBeUndefined();
  });

  it("filters remembered fingerprints inside the window", () => {
    const { d, advance } = setup();
    d.remember(["a"], "inv-1");
    advance(999);
    expect(d.filterNew([alert("a")]).fresh).toEqual([]);
  });

  it("lets a fingerprint through again after the window", () => {
    const { d, advance } = setup();
    d.remember(["a"], "inv-1");
    advance(1000);
    expect(d.filterNew([alert("a")]).fresh).toHaveLength(1);
  });

  it("links a mixed batch to the most recent report covering the old ones", () => {
    const { d, advance } = setup(10_000);
    d.remember(["a"], "inv-1");
    advance(5);
    d.remember(["b"], "inv-2");
    const r = d.filterNew([alert("a"), alert("b"), alert("c")]);
    expect(r.fresh.map((a) => a.fingerprint)).toEqual(["c"]);
    expect(r.relatedTo).toBe("inv-2");
  });

  it("collapses duplicate fingerprints inside one batch", () => {
    const { d } = setup();
    expect(d.filterNew([alert("a"), alert("a")]).fresh).toHaveLength(1);
  });
});
