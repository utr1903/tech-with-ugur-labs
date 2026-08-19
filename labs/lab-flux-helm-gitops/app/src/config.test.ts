import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const baseEnv = {
  API_TOKEN: "token-123",
  PGHOST: "db",
  PGDATABASE: "demo",
  PGUSER: "demo",
  PGPASSWORD: "pw",
};

describe("loadConfig", () => {
  it("applies defaults for PORT, APP_VERSION and PGPORT", () => {
    const config = loadConfig({ ...baseEnv });
    expect(config.port).toBe(3000);
    expect(config.appVersion).toBe(1);
    expect(config.db.port).toBe(5432);
  });

  it("parses explicit values", () => {
    const config = loadConfig({
      ...baseEnv,
      PORT: "8080",
      APP_VERSION: "2",
      PGPORT: "5433",
    });
    expect(config.port).toBe(8080);
    expect(config.appVersion).toBe(2);
    expect(config.db.port).toBe(5433);
  });

  it("throws naming the missing variable", () => {
    const { API_TOKEN: _omitted, ...withoutToken } = baseEnv;
    expect(() => loadConfig(withoutToken)).toThrow(/API_TOKEN/);
  });

  it("rejects a non-numeric port", () => {
    expect(() => loadConfig({ ...baseEnv, PORT: "not-a-port" })).toThrow(
      /PORT/,
    );
  });
});
