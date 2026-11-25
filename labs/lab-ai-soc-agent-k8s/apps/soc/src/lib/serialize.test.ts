import { describe, expect, it } from "vitest";
import { createSerializer } from "./serialize.js";

describe("createSerializer", () => {
  it("runs tasks one at a time in submission order", async () => {
    const run = createSerializer();
    const log: string[] = [];
    const slow = run(async () => {
      log.push("a:start");
      await new Promise((r) => setTimeout(r, 20));
      log.push("a:end");
    });
    const fast = run(async () => {
      log.push("b:start");
      log.push("b:end");
    });
    await Promise.all([slow, fast]);
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("keeps running after a task fails and still rejects that task", async () => {
    const run = createSerializer();
    const failed = run(async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    await expect(run(async () => 7)).resolves.toBe(7);
  });
});
