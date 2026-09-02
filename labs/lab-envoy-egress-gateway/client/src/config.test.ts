import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const baseEnv = {
  CLIENT_NAME: "client-checkout",
  HTTP_PROXY: "http://egress-proxy:3128",
  REQUEST_PLAN: "http://api.payments.example.com/orders@1000",
  DENIED_URL: "http://exfil.shadow-analytics.example.com/collect",
  BYPASS_HOST: "payments-direct.example.com",
};

describe("loadConfig", () => {
  it("splits HTTP_PROXY into a host and a port", () => {
    const cfg = loadConfig(baseEnv);
    expect(cfg.proxyHost).toBe("egress-proxy");
    expect(cfg.proxyPort).toBe(3128);
  });

  it("parses the request plan", () => {
    expect(loadConfig(baseEnv).plan).toEqual([
      { url: "http://api.payments.example.com/orders", everyMs: 1000 },
    ]);
  });

  it("applies the documented defaults", () => {
    const cfg = loadConfig(baseEnv);
    expect(cfg.runSeconds).toBe(120);
    expect(cfg.requestTimeoutMs).toBe(10000);
    expect(cfg.bypassPort).toBe(8080);
  });

  it("overrides the run length from the environment", () => {
    expect(loadConfig({ ...baseEnv, RUN_SECONDS: "5" }).runSeconds).toBe(5);
  });

  it("rejects a missing proxy", () => {
    const { HTTP_PROXY: _omitted, ...withoutProxy } = baseEnv;
    expect(() => loadConfig(withoutProxy)).toThrow(/HTTP_PROXY/);
  });

  it("rejects a proxy url without a port", () => {
    expect(() =>
      loadConfig({ ...baseEnv, HTTP_PROXY: "http://egress-proxy" }),
    ).toThrow(/port/);
  });

  it("rejects a malformed denied url at startup", () => {
    expect(() => loadConfig({ ...baseEnv, DENIED_URL: "exfil" })).toThrow(
      /DENIED_URL must be a url/,
    );
  });

  it("rejects a denied url that is not plain http", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        DENIED_URL: "https://exfil.example.com/collect",
      }),
    ).toThrow(/plain http/);
  });
});
