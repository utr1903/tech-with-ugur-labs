import { describe, expect, it } from "vitest";
import { CallBudget } from "./budget.js";

function fixedClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("CallBudget", () => {
  it("allows calls up to the limit", () => {
    const budget = new CallBudget(3, 60);
    expect(budget.tryConsume("u-1").allowed).toBe(true);
    expect(budget.tryConsume("u-1").allowed).toBe(true);
    const third = budget.tryConsume("u-1");
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it("blocks past the limit", () => {
    const budget = new CallBudget(2, 60);
    budget.tryConsume("u-1");
    budget.tryConsume("u-1");
    const blocked = budget.tryConsume("u-1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterS).toBeGreaterThan(0);
  });

  it("budgets each user separately", () => {
    const budget = new CallBudget(1, 60);
    expect(budget.tryConsume("u-1").allowed).toBe(true);
    expect(budget.tryConsume("u-2").allowed).toBe(true);
  });

  it("lets the window slide", () => {
    const clock = fixedClock();
    const budget = new CallBudget(1, 60, clock.now);
    expect(budget.tryConsume("u-1").allowed).toBe(true);
    expect(budget.tryConsume("u-1").allowed).toBe(false);
    clock.advance(61_000);
    expect(budget.tryConsume("u-1").allowed).toBe(true);
  });
});
