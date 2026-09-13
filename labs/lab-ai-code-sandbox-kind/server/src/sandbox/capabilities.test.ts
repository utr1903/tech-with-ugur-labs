import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { fetchCapabilities } from "./capabilities.js";
import { sampleCapabilities } from "./test-fixtures.js";

const logger = pino({ level: "silent" });

describe("fetchCapabilities", () => {
  it("returns the parsed document", async () => {
    const fetchImpl = vi.fn(async () => Response.json(sampleCapabilities));
    const result = await fetchCapabilities({
      sandboxUrl: "http://sandbox:8000",
      logger,
      fetchImpl,
      attempts: 1,
      delayMs: 0,
    });
    expect(result).toEqual(sampleCapabilities);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://sandbox:8000/capabilities",
      expect.anything(),
    );
  });

  it("retries until the sandbox answers", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(new Response("starting", { status: 503 }))
      .mockResolvedValueOnce(Response.json(sampleCapabilities));
    const result = await fetchCapabilities({
      sandboxUrl: "http://s",
      logger,
      fetchImpl,
      attempts: 3,
      delayMs: 0,
    });
    expect(result.pythonVersion).toBe("3.12.14");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails after the last attempt or on a malformed document", async () => {
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(
      fetchCapabilities({
        sandboxUrl: "http://s",
        logger,
        fetchImpl: down,
        attempts: 2,
        delayMs: 0,
      }),
    ).rejects.toThrow();
    const bad = vi.fn(async () => Response.json({ pythonVersion: 3 }));
    await expect(
      fetchCapabilities({
        sandboxUrl: "http://s",
        logger,
        fetchImpl: bad,
        attempts: 1,
        delayMs: 0,
      }),
    ).rejects.toThrow();
  });
});
