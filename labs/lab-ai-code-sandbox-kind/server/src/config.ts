import { z } from "zod";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(8080),
    DATABASE_URL: z.string().min(1),
    SANDBOX_URL: z.url().default("http://sandbox:8000"),
    SANDBOX_CLIENT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(45_000),
    LLM_MODE: z.enum(["scripted", "live"]).default("scripted"),
    ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
    ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5"),
  })
  .refine(
    (env) => env.LLM_MODE !== "live" || env.ANTHROPIC_API_KEY !== undefined,
    {
      path: ["ANTHROPIC_API_KEY"],
      message: "ANTHROPIC_API_KEY is required when LLM_MODE=live",
    },
  );

export type LlmMode = "scripted" | "live";

export interface Config {
  port: number;
  databaseUrl: string;
  sandboxUrl: string;
  sandboxClientTimeoutMs: number;
  llmMode: LlmMode;
  anthropicApiKey: string | undefined;
  anthropicModel: string;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`Invalid configuration: ${problems.join("; ")}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    sandboxUrl: e.SANDBOX_URL,
    sandboxClientTimeoutMs: e.SANDBOX_CLIENT_TIMEOUT_MS,
    llmMode: e.LLM_MODE,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    anthropicModel: e.ANTHROPIC_MODEL,
  };
}
