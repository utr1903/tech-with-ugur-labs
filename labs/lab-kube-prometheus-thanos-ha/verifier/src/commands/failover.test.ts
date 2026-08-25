import { describe, expect, it } from "vitest";
import { assertOutagePolls } from "./failover.js";

describe("assertOutagePolls", () => {
  it("accepts transient errors as long as one complete success exists", () => {
    expect(() =>
      assertOutagePolls([
        { ok: false, complete: false },
        { ok: true, complete: true },
      ]),
    ).not.toThrow();
  });

  it("rejects a run with zero successful polls", () => {
    expect(() => assertOutagePolls([{ ok: false, complete: false }])).toThrow(
      /no successful/,
    );
  });

  it("rejects any successful-but-incomplete answer — that is a silent gap", () => {
    expect(() =>
      assertOutagePolls([
        { ok: true, complete: true },
        { ok: true, complete: false },
      ]),
    ).toThrow(/incomplete/);
  });
});
