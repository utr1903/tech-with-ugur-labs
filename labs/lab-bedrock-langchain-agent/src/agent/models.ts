/**
 * How Bedrock addresses a model. Some models are reached through an
 * inference profile that routes across Regions; the others are called by
 * their model id inside the Region the app is configured for.
 */
type ModelKind = "global-inference-profile" | "in-region-model-id";

/** One model the agent can run on. */
export type ModelEntry = {
  key: string;
  bedrockId: string;
  kind: ModelKind;
  /** False for a model that rejects an explicit temperature. */
  sendTemperature: boolean;
};

/**
 * The only place Bedrock identifiers appear. Adding a model is one entry
 * here; nothing else in the app changes.
 */
export const MODELS = {
  "minimax-m2.5": {
    key: "minimax-m2.5",
    bedrockId: "minimax.minimax-m2.5",
    kind: "in-region-model-id",
    sendTemperature: true,
  },
  "nemotron-super-3": {
    key: "nemotron-super-3",
    bedrockId: "nvidia.nemotron-super-3-120b",
    kind: "in-region-model-id",
    sendTemperature: true,
  },
  "deepseek-v3.2": {
    key: "deepseek-v3.2",
    bedrockId: "deepseek.v3.2",
    kind: "in-region-model-id",
    sendTemperature: true,
  },
  "kimi-k3": {
    key: "kimi-k3",
    bedrockId: "global.moonshotai.kimi-k3",
    kind: "global-inference-profile",
    sendTemperature: false,
  },
} as const satisfies Record<string, ModelEntry>;

export type ModelKey = keyof typeof MODELS;

/** The keys a request may use, in display order. */
export const MODEL_KEYS = Object.keys(MODELS) as ModelKey[];

/** Looks a request key up; inherited object properties never match. */
export function findModel(key: string): ModelEntry | undefined {
  return Object.hasOwn(MODELS, key) ? MODELS[key as ModelKey] : undefined;
}
