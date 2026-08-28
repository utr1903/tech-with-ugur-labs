export interface AppConfig {
  variant: "vulnerable" | "hardened";
  port: number;
  ollamaBaseUrl: string;
  ollamaModel: string;
  assistantSecret: string; // the canary the assistant is (mis)trusted with
  attackerHost: string; // for the allow-list demo; app never trusts it
}

function readVariant(env: NodeJS.ProcessEnv): "vulnerable" | "hardened" {
  const raw = env.APP_VARIANT;
  if (raw !== "vulnerable" && raw !== "hardened") {
    throw new Error(
      `APP_VARIANT must be "vulnerable" or "hardened", got "${raw}".`,
    );
  }
  return raw;
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

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  return {
    variant: readVariant(env),
    port: readPositiveInt(env, "PORT", 3000),
    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? "http://ollama:11434",
    ollamaModel: env.OLLAMA_MODEL ?? "qwen2.5:3b",
    assistantSecret: env.ASSISTANT_SECRET ?? "CANARY-EXFIL-a1b2c3d4",
    attackerHost: env.ATTACKER_HOST ?? "attacker",
  };
}
