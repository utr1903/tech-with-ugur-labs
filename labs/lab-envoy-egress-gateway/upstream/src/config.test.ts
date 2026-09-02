import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("reads the destination, payload size and port from the environment", () => {
    const cfg = loadConfig({
      PORT: "9090",
      PAYLOAD_BYTES: "4096",
      DESTINATION_NAME: "assets.cdn.example.com",
    });
    expect(cfg).toEqual({
      port: 9090,
      payloadBytes: 4096,
      destinationName: "assets.cdn.example.com",
    });
  });

  it("defaults the port to 8080", () => {
    const cfg = loadConfig({
      PAYLOAD_BYTES: "1",
      DESTINATION_NAME: "a.example.com",
    });
    expect(cfg.port).toBe(8080);
  });

  it("rejects a missing payload size", () => {
    expect(() => loadConfig({ DESTINATION_NAME: "a.example.com" })).toThrow(
      /PAYLOAD_BYTES/,
    );
  });

  it("rejects a non-positive payload size", () => {
    expect(() =>
      loadConfig({ PAYLOAD_BYTES: "0", DESTINATION_NAME: "a.example.com" }),
    ).toThrow(/PAYLOAD_BYTES/);
  });

  it("rejects a missing destination name", () => {
    expect(() => loadConfig({ PAYLOAD_BYTES: "1" })).toThrow(
      /DESTINATION_NAME/,
    );
  });
});
