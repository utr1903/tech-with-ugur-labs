import { describe, expect, it } from "vitest";
import { assertOutagePolls, waitUntilDown } from "./failover.js";

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

describe("waitUntilDown", () => {
  it("returns as soon as isStillUp reports false, without exhausting the deadline", async () => {
    let calls = 0;
    const isStillUp = async () => {
      calls += 1;
      return calls <= 2; // up, up, then down.
    };
    const started = Date.now();
    await waitUntilDown(isStillUp, 5, 0.01);
    const elapsedMs = Date.now() - started;
    expect(calls).toBe(3);
    expect(elapsedMs).toBeLessThan(1000); // well under the 5s deadline.
  });

  it("returns at the deadline when isStillUp never reports false", async () => {
    const isStillUp = async () => true;
    const timeoutSeconds = 0.05;
    const started = Date.now();
    await waitUntilDown(isStillUp, timeoutSeconds, 0.01);
    const elapsedMs = Date.now() - started;
    expect(elapsedMs).toBeGreaterThanOrEqual(timeoutSeconds * 1000);
  });
});
