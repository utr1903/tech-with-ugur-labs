// NOT exported: nothing outside this file ever names the type — consumers
// write `config.llmMode === "gemini"` — so exporting it is an unused export.
type LlmMode = "scripted" | "gemini";

export interface Config {
  port: number;
  jwtSecret: string;
  llmMode: LlmMode;
  geminiApiKey: string;
  geminiModel: string;
  geminiBaseUrl: string;
  agentCallBudget: number;
  agentBudgetWindowS: number;
  agentMaxRequestBytes: number;
  agentMaxMessages: number;
  agentMaxTokens: number;
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new Error(`Expected a number, got "${value}".`);
  return parsed;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const mode = env.LLM_MODE ?? "scripted";
  if (mode !== "scripted" && mode !== "gemini") {
    throw new Error(`LLM_MODE must be "scripted" or "gemini", got "${mode}".`);
  }
  const geminiApiKey = env.GEMINI_API_KEY ?? "";
  if (mode === "gemini" && geminiApiKey === "") {
    throw new Error("GEMINI_API_KEY is required when LLM_MODE=gemini.");
  }
  return {
    port: num(env.PORT, 8080),
    jwtSecret: env.JWT_SECRET ?? "dev-only-secret-change-me",
    llmMode: mode,
    geminiApiKey,
    geminiModel: env.GEMINI_MODEL ?? "gemini-3.8-flash",
    geminiBaseUrl:
      env.GEMINI_BASE_URL ??
      "https://generativelanguage.googleapis.com/v1beta/openai",
    agentCallBudget: num(env.AGENT_CALL_BUDGET, 120),
    agentBudgetWindowS: num(env.AGENT_BUDGET_WINDOW_S, 300),
    agentMaxRequestBytes: num(env.AGENT_MAX_REQUEST_BYTES, 512_000),
    agentMaxMessages: num(env.AGENT_MAX_MESSAGES, 8),
    agentMaxTokens: num(env.AGENT_MAX_TOKENS, 2048),
  };
}
