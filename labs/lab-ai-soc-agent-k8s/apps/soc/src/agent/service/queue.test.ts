import { describe, expect, it } from "vitest";
import { createQueue } from "./queue.js";

describe("createQueue", () => {
  it("runs jobs strictly one at a time, in order", async () => {
    const q = createQueue();
    const log: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const job = (name: string, ms: number) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      log.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`end ${name}`);
      running--;
      return name;
    };
    const results = await Promise.all([
      q.enqueue(job("a", 20)),
      q.enqueue(job("b", 1)),
      q.enqueue(job("c", 1)),
    ]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(maxRunning).toBe(1);
    expect(log).toEqual([
      "start a",
      "end a",
      "start b",
      "end b",
      "start c",
      "end c",
    ]);
  });

  it("keeps going after a failing job and reports size", async () => {
    const q = createQueue();
    const bad = q.enqueue(async () => {
      throw new Error("boom");
    });
    const good = q.enqueue(async () => "ok");
    expect(q.size()).toBe(2);
    await expect(bad).rejects.toThrow("boom");
    await expect(good).resolves.toBe("ok");
    expect(q.size()).toBe(0);
  });
});
