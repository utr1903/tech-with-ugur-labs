import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const fullEnv = {
  GCP_PROJECT_ID: "my-project",
  CLOUDSQL_INSTANCE: "postgres-dr-drill-abc123",
  DB_HOST: "203.0.113.10",
  DB_PORT: "5432",
  DB_NAME: "shop",
  DB_USER: "drill",
  DB_PASSWORD: "secret",
};

describe("loadConfig", () => {
  it("parses a complete environment", () => {
    expect(loadConfig(fullEnv)).toEqual({
      projectId: "my-project",
      instanceName: "postgres-dr-drill-abc123",
      dbHost: "203.0.113.10",
      dbPort: 5432,
      dbName: "shop",
      dbUser: "drill",
      dbPassword: "secret",
    });
  });

  it("defaults DB_PORT to 5432 when unset", () => {
    const { DB_PORT, ...rest } = fullEnv;
    expect(loadConfig(rest).dbPort).toBe(5432);
  });

  it("throws naming the missing variable", () => {
    const { DB_PASSWORD, ...rest } = fullEnv;
    expect(() => loadConfig(rest)).toThrow("DB_PASSWORD");
  });

  it("rejects a non-numeric port", () => {
    expect(() => loadConfig({ ...fullEnv, DB_PORT: "nope" })).toThrow(
      "DB_PORT",
    );
  });
});
