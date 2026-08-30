import { FakeToolCallingModel } from "langchain";
import { describe, expect, it } from "vitest";
import { GardenSimulator } from "../garden/simulator.js";
import { createLogger } from "../logger.js";
import { buildAgent } from "./build-agent.js";
import { GardenChatSession } from "./session.js";
import { createGardenTools } from "./tools.js";

function silentLogger() {
  const logger = createLogger({ appName: "session-test" });
  logger.level = "silent";
  return logger;
}

describe("GardenChatSession", () => {
  it("runs a turn through the agent and returns a string reply", async () => {
    const logger = silentLogger();
    const garden = new GardenSimulator({ seed: 42 });
    const model = new FakeToolCallingModel({
      toolCalls: [
        [{ name: "put_water", args: { plantId: 2, amountMl: 150 }, id: "c1" }],
        [],
      ],
    });
    const agent = buildAgent({
      model,
      tools: createGardenTools({ garden, logger }),
      logger,
    });
    const session = new GardenChatSession({ agent, logger });

    const reply = await session.send("Give plant 2 150 ml of water");

    expect(typeof reply).toBe("string");
    expect(garden.getMoisturePercent(2)).toBeCloseTo(55, 5);
  });

  it("keeps history across turns", async () => {
    const logger = silentLogger();
    const garden = new GardenSimulator({ seed: 42 });
    const model = new FakeToolCallingModel({ toolCalls: [[], []] });
    const agent = buildAgent({
      model,
      tools: createGardenTools({ garden, logger }),
      logger,
    });
    const session = new GardenChatSession({ agent, logger });

    await session.send("hello");
    await session.send("hello again");

    // 2 human + 2 AI messages accumulated
    expect(session.historyLength).toBeGreaterThanOrEqual(4);
  });
});
