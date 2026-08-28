import { describe, expect, it } from "vitest";
import { GardenSimulator, MOISTURE_PERCENT_PER_ML } from "./simulator.js";

describe("GardenSimulator", () => {
  it("lists exactly four plants with IDs 1-4", () => {
    const garden = new GardenSimulator({ seed: 42 });
    const plants = garden.listPlants();
    expect(plants.map((plant) => plant.plantId)).toEqual([1, 2, 3, 4]);
    for (const plant of plants) {
      expect(plant.name.length).toBeGreaterThan(0);
      expect(plant.species.length).toBeGreaterThan(0);
    }
  });

  it("gives identical reading sequences for identical seeds", () => {
    const gardenA = new GardenSimulator({ seed: 7 });
    const gardenB = new GardenSimulator({ seed: 7 });
    const readingsA = [1, 2, 3, 4].map((id) => gardenA.measureTemperature(id));
    const readingsB = [1, 2, 3, 4].map((id) => gardenB.measureTemperature(id));
    expect(readingsA).toEqual(readingsB);
  });

  it("gives different readings for different seeds", () => {
    const gardenA = new GardenSimulator({ seed: 1 });
    const gardenB = new GardenSimulator({ seed: 2 });
    const readingsA = [1, 2, 3, 4].map((id) => gardenA.measureTemperature(id));
    const readingsB = [1, 2, 3, 4].map((id) => gardenB.measureTemperature(id));
    expect(readingsA).not.toEqual(readingsB);
  });

  it("keeps temperature within its plausible band", () => {
    const garden = new GardenSimulator({ seed: 42 });
    for (let i = 0; i < 50; i++) {
      const value = garden.measureTemperature(3);
      expect(value).toBeGreaterThanOrEqual(22.0);
      expect(value).toBeLessThanOrEqual(26.0);
    }
  });

  it("keeps humidity within its plausible band", () => {
    const garden = new GardenSimulator({ seed: 42 });
    for (let i = 0; i < 50; i++) {
      const value = garden.measureHumidity(1);
      expect(value).toBeGreaterThanOrEqual(50.0);
      expect(value).toBeLessThanOrEqual(60.0);
    }
  });

  it("raises moisture by exactly amountMl * MOISTURE_PERCENT_PER_ML", () => {
    const garden = new GardenSimulator({ seed: 42 });
    const before = garden.getMoisturePercent(2);
    const result = garden.putWater(2, 150);
    expect(result.addedMoisturePercent).toBeCloseTo(
      150 * MOISTURE_PERCENT_PER_ML,
      5,
    );
    expect(garden.getMoisturePercent(2)).toBeCloseTo(
      before + 150 * MOISTURE_PERCENT_PER_ML,
      5,
    );
  });

  it("caps moisture at 100 percent", () => {
    const garden = new GardenSimulator({ seed: 42 });
    garden.putWater(1, 100000);
    expect(garden.getMoisturePercent(1)).toBe(100);
  });

  it("throws RangeError for unknown plant IDs", () => {
    const garden = new GardenSimulator({ seed: 42 });
    expect(() => garden.measureTemperature(9)).toThrow(RangeError);
    expect(() => garden.measureHumidity(0)).toThrow(RangeError);
    expect(() => garden.putWater(5, 10)).toThrow(RangeError);
  });
});
