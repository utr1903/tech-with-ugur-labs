import { FakeToolCallingModel, type ToolCall } from "langchain";
import { describe, expect, it } from "vitest";
import { buildAgent } from "../agent/build-agent.js";
import { GardenChatSession } from "../agent/session.js";
import { createToolCallRecorder } from "../agent/tool-call-recorder.js";
import { createGardenTools } from "../agent/tools.js";
import { GardenSimulator } from "../garden/simulator.js";
import { createLogger } from "../logger.js";
import { runScriptedConversation } from "./script.js";

function silentLogger() {
  const logger = createLogger({ appName: "script-test" });
  logger.level = "silent";
  return logger;
}

function buildHarness(toolCalls: ToolCall[][]) {
  const logger = silentLogger();
  const garden = new GardenSimulator({ seed: 42 });
  const recorder = createToolCallRecorder();
  const agent = buildAgent({
    model: new FakeToolCallingModel({ toolCalls }),
    tools: createGardenTools({ garden, logger }),
    logger,
    extraMiddleware: [recorder.middleware],
  });
  const session = new GardenChatSession({ agent, logger });
  return { session, recorder, garden, logger };
}

// The fake model answers each turn with the correct tool call, then a
// final text turn. FakeToolCallingModel echoes message content, so turn 1's
// "reply mentions IDs 1-4" check is satisfied by the tool result flowing
// into the echoed content — if the fake's echo turns out not to include
// the IDs, relax ONLY the turn-1 prose check under the fake by asserting
// the recorded list_plants call (the live e2e still checks the prose).
const CORRECT_SCRIPT = [
  [{ name: "list_plants", args: {}, id: "c1" }],
  [],
  [{ name: "measure_temperature", args: { plantId: 3 }, id: "c2" }],
  [],
  [{ name: "measure_humidity", args: { plantId: 1 }, id: "c3" }],
  [],
  [{ name: "put_water", args: { plantId: 2, amountMl: 150 }, id: "c4" }],
  [],
];

describe("runScriptedConversation", () => {
  it("passes when every expected tool call happens", async () => {
    const harness = buildHarness(CORRECT_SCRIPT);
    const ok = await runScriptedConversation(harness);
    expect(ok).toBe(true);
  });

  it("fails when the agent calls the wrong tool", async () => {
    const wrongScript = [
      [{ name: "list_plants", args: {}, id: "c1" }],
      [],
      [{ name: "measure_humidity", args: { plantId: 3 }, id: "c2" }], // wrong tool
      [],
      [{ name: "measure_humidity", args: { plantId: 1 }, id: "c3" }],
      [],
      [{ name: "put_water", args: { plantId: 2, amountMl: 150 }, id: "c4" }],
      [],
    ];
    const harness = buildHarness(wrongScript);
    const ok = await runScriptedConversation(harness);
    expect(ok).toBe(false);
  });
});
