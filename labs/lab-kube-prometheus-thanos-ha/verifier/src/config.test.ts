import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies documented defaults when env is empty", () => {
    const cfg = loadConfig({});
    expect(cfg.vanillaPromUrl).toBe("http://127.0.0.1:30900");
    expect(cfg.thanosQueryUrl).toBe("http://127.0.0.1:30903");
    expect(cfg.shard0PromUrl).toBe("http://127.0.0.1:30901");
    expect(cfg.shard1PromUrl).toBe("http://127.0.0.1:30902");
    expect(cfg.grafanaUrl).toBe("http://127.0.0.1:30904");
    expect(cfg.grafanaUser).toBe("admin");
    expect(cfg.thanosNamespace).toBe("monitoring-thanos");
    expect(cfg.promKillPod).toBe("prometheus-kps-thanos-prometheus-1");
  });

  it("prefers env values over defaults", () => {
    const cfg = loadConfig({
      THANOS_QUERY_URL: "http://example:1",
      GRAFANA_PASSWORD: "s3cret",
    });
    expect(cfg.thanosQueryUrl).toBe("http://example:1");
    expect(cfg.grafanaPassword).toBe("s3cret");
  });
});
