import { beforeEach, describe, expect, it } from "vitest";
import { GardenSimulator } from "../garden/simulator.js";
import { createLogger } from "../logger.js";
import { createGardenTools } from "./tools.js";

function silentLogger() {
  const logger = createLogger({ appName: "tools-test" });
  logger.level = "silent";
  return logger;
}

describe("createGardenTools", () => {
  let garden: GardenSimulator;
  let tools: ReturnType<typeof createGardenTools>;

  beforeEach(() => {
    garden = new GardenSimulator({ seed: 42 });
    tools = createGardenTools({ garden, logger: silentLogger() });
  });

  function toolByName(name: string) {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`missing tool ${name}`);
    return tool;
  }

  it("exposes exactly the four garden tools", () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "list_plants",
      "measure_humidity",
      "measure_temperature",
      "put_water",
    ]);
  });

  it("list_plants returns all four plants as JSON", async () => {
    const raw = await toolByName("list_plants").invoke({});
    const plants = JSON.parse(raw);
    expect(plants).toHaveLength(4);
    expect(plants.map((plant: { plantId: number }) => plant.plantId)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("measure_temperature returns a numeric reading for the plant", async () => {
    const raw = await toolByName("measure_temperature").invoke({ plantId: 3 });
    const reading = JSON.parse(raw);
    expect(reading.plantId).toBe(3);
    expect(typeof reading.temperatureCelsius).toBe("number");
  });

  it("measure_humidity returns a numeric reading for the plant", async () => {
    const raw = await toolByName("measure_humidity").invoke({ plantId: 1 });
    const reading = JSON.parse(raw);
    expect(reading.plantId).toBe(1);
    expect(typeof reading.humidityPercent).toBe("number");
  });

  it("put_water waters the plant and reports the new moisture", async () => {
    const before = garden.getMoisturePercent(2);
    const raw = await toolByName("put_water").invoke({
      plantId: 2,
      amountMl: 150,
    });
    const result = JSON.parse(raw);
    expect(result.plantId).toBe(2);
    expect(result.moisturePercent).toBeCloseTo(before + 15, 5);
  });

  it("rejects an out-of-range plant ID at the schema boundary", async () => {
    await expect(
      toolByName("measure_temperature").invoke({ plantId: 9 }),
    ).rejects.toThrow();
  });
});
