import { describe, expect, it } from "vitest";
import { loadConfig, loadInternalApiKey } from "./config.js";

describe("loadConfig", () => {
  it("reads port and database url from the environment", () => {
    const cfg = loadConfig({
      PORT: "3000",
      DATABASE_URL: "postgres://u:p@db:5432/appdb",
    });
    expect(cfg.port).toBe(3000);
    expect(cfg.databaseUrl).toBe("postgres://u:p@db:5432/appdb");
  });
});

describe("loadInternalApiKey", () => {
  it("reads the key from the environment", () => {
    expect(loadInternalApiKey({ INTERNAL_API_KEY: "some-key" })).toBe(
      "some-key",
    );
  });

  it("defaults to an empty string when unset", () => {
    expect(loadInternalApiKey({})).toBe("");
  });
});
