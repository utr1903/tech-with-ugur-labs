import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../logger.js";
import { createStepLoggingMiddleware } from "./logging-middleware.js";

describe("createStepLoggingMiddleware", () => {
  it("builds a named middleware with model and tool hooks", () => {
    const logger = createLogger({ appName: "mw-test" });
    logger.level = "silent";
    const infoSpy = vi.spyOn(logger, "info");
    const middleware = createStepLoggingMiddleware({ logger });
    expect(middleware.name).toBe("StepLoggingMiddleware");
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
