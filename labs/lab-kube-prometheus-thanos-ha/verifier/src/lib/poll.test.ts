import pino from "pino";
import { describe, expect, it } from "vitest";
import { pollUntil } from "./poll.js";

const logger = pino({ level: "silent" });

describe("pollUntil", () => {
  it("returns the first successful attempt's value", async () => {
    let calls = 0;
    const result = await pollUntil({
      logger,
      description: "flaky thing",
      timeoutSeconds: 2,
      intervalSeconds: 0.01,
      attempt: async () => {
        calls += 1;
        if (calls < 3) throw new Error("not yet");
        return "done";
      },
    });
    expect(result).toBe("done");
    expect(calls).toBe(3);
  });

  it("throws the last error after the deadline", async () => {
    await expect(
      pollUntil({
        logger,
        description: "never ready",
        timeoutSeconds: 0.05,
        intervalSeconds: 0.01,
        attempt: async () => {
          throw new Error("still broken");
        },
      }),
    ).rejects.toThrow(/still broken/);
  });
});
