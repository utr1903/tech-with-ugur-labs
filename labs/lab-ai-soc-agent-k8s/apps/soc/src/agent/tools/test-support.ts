import { createLogger } from "../../logger.js";
import type { LokiClient } from "./loki-client.js";
import type { InvestigationState, ToolDeps } from "./types.js";

export const FIXED_NOW = new Date("2026-11-25T12:00:00.000Z");

export function makeDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  const loki: LokiClient = {
    queryRange: async () => ({ resultType: "streams", result: [] }),
    instant: async () => ({ resultType: "vector", result: [] }),
  };
  return {
    loki,
    k8s: { read: async () => [] },
    secrets: { read: async () => [] },
    alerts: [],
    logger: createLogger({ appName: "test" }),
    now: () => FIXED_NOW,
    ...overrides,
  };
}

export function makeState(
  mode: InvestigationState["mode"] = "investigate",
): InvestigationState {
  return { proposals: [], verdicts: [], mode };
}

/** Tool runs return text here; the SDK also allows content blocks. */
export function asText(out: string | unknown[]): string {
  if (typeof out !== "string") throw new Error("expected a string result");
  return out;
}

/** Strips the untrusted wrapper and parses the JSON inside. */
export function unwrapJson(out: string | unknown[]): unknown {
  const m = asText(out).match(
    /^<untrusted_tool_output[^>]*>\n([\s\S]*)\n<\/untrusted_tool_output>$/,
  );
  if (!m?.[1]) throw new Error("not wrapped");
  return JSON.parse(m[1]);
}

/** The SDK's tool union does not type `description` on every member. */
export function descriptionOf(tool: object): string {
  return (tool as { description?: string }).description ?? "";
}
