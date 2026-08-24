export type AnalyzerConfig = {
  eventsPath: string;
  blocklistPath: string;
  reportPath: string;
  composeConfigPath: string;
};

export function loadConfig(env: NodeJS.ProcessEnv): AnalyzerConfig {
  return {
    eventsPath: env.EVENTS_PATH ?? "/events/tracee.jsonl",
    blocklistPath: env.BLOCKLIST_PATH ?? "/threat-intel/blocklist.hosts",
    reportPath: env.REPORT_PATH ?? "/out/report.json",
    composeConfigPath: env.COMPOSE_CONFIG_PATH ?? "/verify/compose-config.json",
  };
}
