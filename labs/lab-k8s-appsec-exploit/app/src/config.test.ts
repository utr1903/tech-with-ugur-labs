import { describe, expect, it } from "vitest";
import { INTERNAL_API_KEY, loadConfig } from "./config.js";

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

describe("INTERNAL_API_KEY", () => {
  // DELIBERATELY VULNERABLE: a real secret hardcoded in source and shipped in
  // the image. This test pins the canary so the secret-leak exploit can match it.
  it("is the committed canary key", () => {
    expect(INTERNAL_API_KEY).toBe("sk-vuln-lab-DO-NOT-USE-0000-canary");
  });
});
