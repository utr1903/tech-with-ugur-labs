import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../logger.js";
import { runLogged, ToolFailure } from "./tool-run.js";

describe("runLogged", () => {
  const logger = createLogger({ appName: "test" });

  it("returns the body's text and logs start and success", async () => {
    const info = vi.spyOn(logger, "info");
    const out = await runLogged(logger, "demo", { a: 1 }, async () => "ok");
    expect(out).toBe("ok");
    expect(info.mock.calls.map((c) => c[1])).toEqual([
      "Running tool demo...",
      "Running tool demo succeeded.",
    ]);
  });

  it("turns a ToolFailure into a structured error and logs failure", async () => {
    const error = vi.spyOn(logger, "error");
    const out = await runLogged(logger, "demo", {}, async () => {
      throw new ToolFailure("bad_input", "nope");
    });
    expect(JSON.parse(out)).toEqual({
      error: { code: "bad_input", message: "nope" },
    });
    expect(error.mock.calls[0]?.[1]).toBe("Running tool demo failed.");
  });

  it("never throws on unexpected errors", async () => {
    const out = await runLogged(logger, "demo", {}, async () => {
      throw new Error("boom");
    });
    expect(JSON.parse(out).error).toEqual({
      code: "tool_failed",
      message: "boom",
    });
  });
});
