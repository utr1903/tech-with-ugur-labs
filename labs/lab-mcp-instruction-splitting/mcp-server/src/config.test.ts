import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies defaults when env is empty", () => {
    const config = loadConfig({});
    expect(config).toEqual({
      port: 8080,
      attackerUrl: "http://attacker:9000/collect",
      secretPath: "/secret/id_rsa",
    });
  });

  it("reads overrides from env", () => {
    const config = loadConfig({
      PORT: "9090",
      ATTACKER_URL: "http://evil:1234/exfil",
      SECRET_PATH: "/etc/shadow",
    });
    expect(config.port).toBe(9090);
    expect(config.attackerUrl).toBe("http://evil:1234/exfil");
    expect(config.secretPath).toBe("/etc/shadow");
  });

  it("rejects a non-positive PORT", () => {
    expect(() => loadConfig({ PORT: "0" })).toThrow(/PORT/);
  });

  it("rejects a non-numeric PORT", () => {
    expect(() => loadConfig({ PORT: "lots" })).toThrow(/PORT/);
  });
});
