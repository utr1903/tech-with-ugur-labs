import { describe, expect, it } from "vitest";
import {
  createTally,
  recordDenied,
  recordFailure,
  recordSuccess,
  totalSuccesses,
} from "./tally.js";

describe("tally", () => {
  it("counts successes and bytes per destination hostname", () => {
    const tally = createTally();
    recordSuccess(tally, "http://api.payments.example.com/orders", 2048);
    recordSuccess(tally, "http://api.payments.example.com/refunds", 2048);
    recordSuccess(tally, "http://assets.cdn.example.com/bundle.js", 65536);
    expect(tally.successesByDestination).toEqual({
      "api.payments.example.com": 2,
      "assets.cdn.example.com": 1,
    });
    expect(tally.bytesByDestination).toEqual({
      "api.payments.example.com": 4096,
      "assets.cdn.example.com": 65536,
    });
  });

  it("counts denied and failed attempts separately", () => {
    const tally = createTally();
    recordDenied(tally);
    recordFailure(tally);
    recordFailure(tally);
    expect(tally.deniedCount).toBe(1);
    expect(tally.failureCount).toBe(2);
  });

  it("totals successes across destinations", () => {
    const tally = createTally();
    recordSuccess(tally, "http://a.example.com/x", 1);
    recordSuccess(tally, "http://b.example.com/y", 1);
    expect(totalSuccesses(tally)).toBe(2);
  });
});
