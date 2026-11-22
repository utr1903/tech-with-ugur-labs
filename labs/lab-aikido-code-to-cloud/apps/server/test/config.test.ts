import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig({ DATA_BUCKET: "b" })).toEqual({
      port: 8080,
      awsRegion: "eu-central-1",
      dataBucket: "b",
      bedrockModelId: "eu.amazon.nova-2-lite-v1:0",
      aikidoToken: undefined,
      aikidoBlock: true,
    });
  });
  it("requires DATA_BUCKET", () =>
    expect(() => loadConfig({})).toThrow("DATA_BUCKET is required"));
  it("parses AIKIDO_BLOCK=false and PORT", () => {
    const c = loadConfig({ DATA_BUCKET: "b", AIKIDO_BLOCK: "false", PORT: "9000" });
    expect([c.aikidoBlock, c.port]).toEqual([false, 9000]);
  });
});
