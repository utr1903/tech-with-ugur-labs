export type AnalyzerConfig = {
  dnsLogPath: string;
  capturePath: string;
  blocklistPath: string;
  reportPath: string;
};

export function loadConfig(env: NodeJS.ProcessEnv): AnalyzerConfig {
  return {
    dnsLogPath: env.DNS_LOG_PATH ?? "/var/log/dns/queries.log",
    capturePath: env.CAPTURE_PATH ?? "/capture/capture.jsonl",
    blocklistPath: env.BLOCKLIST_PATH ?? "/threat-intel/blocklist.hosts",
    reportPath: env.REPORT_PATH ?? "/out/report.json",
  };
}
