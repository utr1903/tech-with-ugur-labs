export interface PlantInfo {
  plantId: number;
  name: string;
  species: string;
}

export interface WaterResult {
  plantId: number;
  addedMoisturePercent: number;
  moisturePercent: number;
}

export const MOISTURE_PERCENT_PER_ML = 0.1;

const PLANTS: readonly (PlantInfo & {
  baseTemperatureC: number;
  baseHumidityPercent: number;
})[] = [
  {
    plantId: 1,
    name: "Basil",
    species: "Ocimum basilicum",
    baseTemperatureC: 21.0,
    baseHumidityPercent: 55.0,
  },
  {
    plantId: 2,
    name: "Monstera",
    species: "Monstera deliciosa",
    baseTemperatureC: 23.0,
    baseHumidityPercent: 60.0,
  },
  {
    plantId: 3,
    name: "Chili",
    species: "Capsicum annuum",
    baseTemperatureC: 24.0,
    baseHumidityPercent: 50.0,
  },
  {
    plantId: 4,
    name: "Boston Fern",
    species: "Nephrolepis exaltata",
    baseTemperatureC: 19.0,
    baseHumidityPercent: 70.0,
  },
];

const TEMPERATURE_SWING_C = 2.0;
const HUMIDITY_SWING_PERCENT = 5.0;
const INITIAL_MOISTURE_PERCENT = 40.0;

// Deterministic PRNG (mulberry32): same seed, same reading sequence —
// keeps the lab reproducible and the e2e assertions exact.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export class GardenSimulator {
  private readonly temperatureRandom: () => number;
  private readonly humidityRandom: () => number;
  private readonly moistureByPlantId = new Map<number, number>();

  constructor({ seed }: { seed: number }) {
    this.temperatureRandom = mulberry32(seed);
    this.humidityRandom = mulberry32(seed + 1);
    for (const plant of PLANTS) {
      this.moistureByPlantId.set(plant.plantId, INITIAL_MOISTURE_PERCENT);
    }
  }

  listPlants(): PlantInfo[] {
    return PLANTS.map(({ plantId, name, species }) => ({
      plantId,
      name,
      species,
    }));
  }

  measureTemperature(plantId: number): number {
    const plant = this.requirePlant(plantId);
    const drift = (this.temperatureRandom() * 2 - 1) * TEMPERATURE_SWING_C;
    return round1(plant.baseTemperatureC + drift);
  }

  measureHumidity(plantId: number): number {
    const plant = this.requirePlant(plantId);
    const drift = (this.humidityRandom() * 2 - 1) * HUMIDITY_SWING_PERCENT;
    return round1(plant.baseHumidityPercent + drift);
  }

  putWater(plantId: number, amountMl: number): WaterResult {
    this.requirePlant(plantId);
    const before = this.getMoisturePercent(plantId);
    const after = Math.min(100, before + amountMl * MOISTURE_PERCENT_PER_ML);
    this.moistureByPlantId.set(plantId, after);
    return {
      plantId,
      addedMoisturePercent: after - before,
      moisturePercent: after,
    };
  }

  getMoisturePercent(plantId: number): number {
    const moisture = this.moistureByPlantId.get(plantId);
    if (moisture === undefined) {
      throw new RangeError(`Unknown plant ID ${plantId}. Valid IDs are 1-4.`);
    }
    return moisture;
  }

  private requirePlant(plantId: number) {
    const plant = PLANTS.find((candidate) => candidate.plantId === plantId);
    if (plant === undefined) {
      throw new RangeError(`Unknown plant ID ${plantId}. Valid IDs are 1-4.`);
    }
    return plant;
  }
}
