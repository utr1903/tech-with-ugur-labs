export interface AgentConfig {
  guard: boolean;
  port: number;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaNumCtx: number;
  mcpServerUrl: string;
  secretDir: string;
}

function readPositiveInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}".`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): AgentConfig {
  return {
    guard: env.GUARD === "on",
    port: readPositiveInt(env, "PORT", 3000),
    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? "http://ollama:11434",
    ollamaModel: env.OLLAMA_MODEL ?? "qwen2.5:3b",
    ollamaNumCtx: readPositiveInt(env, "OLLAMA_NUM_CTX", 8192),
    mcpServerUrl: env.MCP_SERVER_URL ?? "http://mcp-server:8080/mcp",
    secretDir: env.SECRET_DIR ?? "/secret",
  };
}
