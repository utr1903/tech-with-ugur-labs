import { FakeToolCallingModel } from "langchain";
import { describe, expect, it } from "vitest";
import { GardenSimulator } from "../garden/simulator.js";
import { createLogger } from "../logger.js";
import { buildAgent } from "./build-agent.js";
import { createToolCallRecorder } from "./tool-call-recorder.js";
import { createGardenTools } from "./tools.js";

function silentLogger() {
  const logger = createLogger({ appName: "recorder-test" });
  logger.level = "silent";
  return logger;
}

describe("createToolCallRecorder", () => {
  it("records tool name and args for each executed tool call", async () => {
    const logger = silentLogger();
    const garden = new GardenSimulator({ seed: 42 });
    const tools = createGardenTools({ garden, logger });
    const recorder = createToolCallRecorder();
    const model = new FakeToolCallingModel({
      toolCalls: [
        [{ name: "measure_temperature", args: { plantId: 3 }, id: "call-1" }],
        [],
      ],
    });
    const agent = buildAgent({
      model,
      tools,
      logger,
      extraMiddleware: [recorder.middleware],
    });

    await agent.invoke({
      messages: [{ role: "user", content: "How warm is plant 3?" }],
    });

    expect(recorder.calls).toEqual([
      { tool: "measure_temperature", args: { plantId: 3 } },
    ]);
  });
});
