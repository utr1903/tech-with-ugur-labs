export type AgentConfig = {
  agentToken: string;
  responderUrl: string;
  responderToken: string;
  lokiUrl: string;
  reportsDir: string;
  tokenBudget: number;
  maxIterations: number;
  port: number;
};

const REQUIRED = [
  "AGENT_TOKEN",
  "RESPONDER_URL",
  "RESPONDER_TOKEN",
  "LOKI_URL",
  "REPORTS_DIR",
  "ANTHROPIC_API_KEY",
] as const;

function num(env: Record<string, string | undefined>, name: string, d: number) {
  const raw = env[name];
  if (raw === undefined || raw === "") return d;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`${name} must be a positive number`);
  return n;
}

/** Reads and validates the environment. Errors name variables, never values. */
export function loadConfig(
  env: Record<string, string | undefined>,
): AgentConfig {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment: ${missing.join(", ")}`);
  }
  return {
    agentToken: env.AGENT_TOKEN ?? "",
    responderUrl: env.RESPONDER_URL ?? "",
    responderToken: env.RESPONDER_TOKEN ?? "",
    lokiUrl: env.LOKI_URL ?? "",
    reportsDir: env.REPORTS_DIR ?? "",
    tokenBudget: num(env, "INVESTIGATION_TOKEN_BUDGET", 400000),
    maxIterations: num(env, "MAX_ITERATIONS", 25),
    port: num(env, "PORT", 8080),
  };
}
