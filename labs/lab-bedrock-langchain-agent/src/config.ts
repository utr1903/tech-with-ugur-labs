import { z } from "zod";

/** How many times the model may be called for one question. */
const AGENT_MAX_MODEL_TURNS = 10;

/**
 * LangGraph counts one step per model turn and one per tool round, so ten
 * model turns with a tool round between each need 2 x 10 + 1 steps.
 */
export const AGENT_RECURSION_LIMIT = AGENT_MAX_MODEL_TURNS * 2 + 1;

/** A request that takes longer than this is answered with 504. */
export const REQUEST_TIMEOUT_MS = 60_000;

/** Upper bound for one model reply; answers in this lab are short. */
export const MAX_OUTPUT_TOKENS = 2048;

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AWS_REGION: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.string().min(1).default("info"),
});

/** Everything the app reads from the environment, parsed once at startup. */
export type Config = {
  databaseUrl: string;
  awsRegion: string;
  port: number;
  logLevel: string;
};

/**
 * Parses the environment and fails with the names of all invalid variables,
 * so a misconfigured container stops at startup with a usable message.
 */
export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join("."));
    throw new Error(`Invalid environment: ${[...new Set(names)].join(", ")}`);
  }
  return {
    databaseUrl: parsed.data.DATABASE_URL,
    awsRegion: parsed.data.AWS_REGION,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL,
  };
}
