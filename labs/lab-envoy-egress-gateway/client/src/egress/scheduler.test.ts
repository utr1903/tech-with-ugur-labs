import { describe, expect, it } from "vitest";
import { startSchedule } from "./scheduler.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("startSchedule", () => {
  it("fires each plan entry on its own interval", async () => {
    const seen: string[] = [];
    const stop = startSchedule(
      [
        { url: "http://fast.example.com/x", everyMs: 10 },
        { url: "http://slow.example.com/y", everyMs: 100 },
      ],
      (url) => seen.push(url),
    );
    await sleep(60);
    stop();
    const fast = seen.filter((url) => url.includes("fast")).length;
    const slow = seen.filter((url) => url.includes("slow")).length;
    expect(fast).toBeGreaterThanOrEqual(3);
    expect(slow).toBe(0);
  });

  it("stops firing once stopped", async () => {
    let ticks = 0;
    const stop = startSchedule(
      [{ url: "http://a.example.com/x", everyMs: 10 }],
      () => {
        ticks += 1;
      },
    );
    await sleep(40);
    stop();
    const atStop = ticks;
    await sleep(50);
    expect(ticks).toBe(atStop);
  });
});
