export interface AppConfig {
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaNumCtx: number;
  tavilyApiKey: string | undefined;
  searchMaxResults: number;
  maxAgentSteps: number;
  researchDir: string;
}

function readNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got "${raw}".`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  return {
    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    ollamaModel: env.OLLAMA_MODEL ?? "qwen3:4b",
    ollamaNumCtx: readNumber(env, "OLLAMA_NUM_CTX", 16384),
    tavilyApiKey: env.TAVILY_API_KEY,
    searchMaxResults: readNumber(env, "SEARCH_MAX_RESULTS", 5),
    maxAgentSteps: readNumber(env, "MAX_AGENT_STEPS", 60),
    researchDir: env.RESEARCH_DIR ?? "research",
  };
}
