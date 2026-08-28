import { DynamicStructuredTool } from "langchain";
import { z } from "zod";
import type { GardenSimulator } from "../garden/simulator.js";
import type { Logger } from "../logger.js";

const plantIdSchema = z
  .number()
  .int()
  .min(1)
  .max(4)
  .describe("Numeric ID of the plant, between 1 and 4.");

// Shared wrapper: run the handler, JSON-encode the result, and turn any
// failure into an "Error: ..." string so one bad call never kills the run.
async function runTool(
  logger: Logger,
  toolName: string,
  handler: () => unknown,
): Promise<string> {
  try {
    const result = handler();
    return JSON.stringify(result);
  } catch (err) {
    logger.error({ err, toolName }, "Garden tool failed.");
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function createListPlantsTool(
  garden: GardenSimulator,
  logger: Logger,
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "list_plants",
    description:
      "List every plant in the indoor garden with its numeric ID, name, and " +
      "species. Use for questions like 'what plants do I have?'. Do NOT use " +
      "it to read sensor values — use the measure tools for that.",
    schema: z.object({}),
    func: () => runTool(logger, "list_plants", () => garden.listPlants()),
  });
}

function createMeasureTemperatureTool(
  garden: GardenSimulator,
  logger: Logger,
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "measure_temperature",
    description:
      "Read the current temperature sensor of one plant, in degrees " +
      "Celsius. Use for questions about how warm or cold a specific plant " +
      "is. Do NOT use it for humidity or moisture.",
    schema: z.object({ plantId: plantIdSchema }),
    func: ({ plantId }) =>
      runTool(logger, "measure_temperature", () => ({
        plantId,
        temperatureCelsius: garden.measureTemperature(plantId),
      })),
  });
}

function createMeasureHumidityTool(
  garden: GardenSimulator,
  logger: Logger,
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "measure_humidity",
    description:
      "Read the current air-humidity sensor of one plant, in percent. Use " +
      "for questions about how humid a specific plant's air is. Do NOT use " +
      "it for temperature or for soil moisture.",
    schema: z.object({ plantId: plantIdSchema }),
    func: ({ plantId }) =>
      runTool(logger, "measure_humidity", () => ({
        plantId,
        humidityPercent: garden.measureHumidity(plantId),
      })),
  });
}

function createPutWaterTool(
  garden: GardenSimulator,
  logger: Logger,
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "put_water",
    description:
      "Water one plant with a given amount of water in milliliters. Use " +
      "when the user asks to water a plant. Do NOT use it to read any " +
      "sensor value. Returns the plant's new soil-moisture percentage.",
    schema: z.object({
      plantId: plantIdSchema,
      amountMl: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .describe("Amount of water to give, in milliliters (1-1000)."),
    }),
    func: ({ plantId, amountMl }) =>
      runTool(logger, "put_water", () => garden.putWater(plantId, amountMl)),
  });
}

export function createGardenTools({
  garden,
  logger,
}: {
  garden: GardenSimulator;
  logger: Logger;
}): DynamicStructuredTool[] {
  return [
    createListPlantsTool(garden, logger),
    createMeasureTemperatureTool(garden, logger),
    createMeasureHumidityTool(garden, logger),
    createPutWaterTool(garden, logger),
  ];
}
