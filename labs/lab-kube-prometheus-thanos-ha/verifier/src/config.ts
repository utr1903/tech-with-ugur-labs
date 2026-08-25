export type Config = {
  vanillaPromUrl: string;
  thanosQueryUrl: string;
  shard0PromUrl: string;
  shard1PromUrl: string;
  grafanaUrl: string;
  grafanaUser: string;
  grafanaPassword: string;
  thanosNamespace: string;
  promKillPod: string;
};

export function loadConfig(env: Record<string, string | undefined>): Config {
  return {
    vanillaPromUrl: env.VANILLA_PROM_URL ?? "http://127.0.0.1:30900",
    thanosQueryUrl: env.THANOS_QUERY_URL ?? "http://127.0.0.1:30903",
    shard0PromUrl: env.SHARD0_PROM_URL ?? "http://127.0.0.1:30901",
    shard1PromUrl: env.SHARD1_PROM_URL ?? "http://127.0.0.1:30902",
    grafanaUrl: env.GRAFANA_URL ?? "http://127.0.0.1:30904",
    grafanaUser: env.GRAFANA_USER ?? "admin",
    grafanaPassword: env.GRAFANA_PASSWORD ?? "",
    thanosNamespace: env.THANOS_NAMESPACE ?? "monitoring-thanos",
    promKillPod: env.PROM_KILL_POD ?? "prometheus-kps-thanos-prometheus-1",
  };
}
