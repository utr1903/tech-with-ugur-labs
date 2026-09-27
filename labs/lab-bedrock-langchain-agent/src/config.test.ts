import { describe, expect, it } from "vitest";
import { AGENT_RECURSION_LIMIT, parseConfig } from "./config.js";

const valid = {
  DATABASE_URL: "postgres://shop:shop@postgres:5432/shop",
  AWS_REGION: "us-east-1",
};

describe("parseConfig", () => {
  it("reads the required values and applies defaults", () => {
    expect(parseConfig(valid)).toEqual({
      databaseUrl: valid.DATABASE_URL,
      awsRegion: "us-east-1",
      port: 3000,
      logLevel: "info",
    });
  });

  it("reads PORT and LOG_LEVEL when set", () => {
    const config = parseConfig({ ...valid, PORT: "8080", LOG_LEVEL: "debug" });
    expect(config.port).toBe(8080);
    expect(config.logLevel).toBe("debug");
  });

  it.each(["DATABASE_URL", "AWS_REGION"])(
    "names %s when it is missing",
    (key) => {
      const env = { ...valid, [key]: undefined };
      expect(() => parseConfig(env)).toThrow(key);
    },
  );

  it("rejects a PORT that is not a port number", () => {
    expect(() => parseConfig({ ...valid, PORT: "70000" })).toThrow("PORT");
  });

  it("allows one tool round per model turn plus the final answer", () => {
    expect(AGENT_RECURSION_LIMIT).toBe(21);
  });
});
