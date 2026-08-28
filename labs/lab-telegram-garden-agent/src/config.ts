import { z } from "zod";

export type Transport = "telegram" | "script";

export interface AppConfig {
  transport: Transport;
  claudeModel: string;
  gardenSeed: number;
  telegram?: { botToken: string; allowedChatId: number };
}

const baseSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string({ error: "ANTHROPIC_API_KEY is required" })
    .min(1, "ANTHROPIC_API_KEY is required"),
  TRANSPORT: z.enum(["telegram", "script"]).default("telegram"),
  CLAUDE_MODEL: z.string().min(1).default("claude-haiku-4-5"),
  GARDEN_SEED: z.coerce.number().int().default(42),
});

const telegramSchema = z.object({
  TELEGRAM_BOT_TOKEN: z
    .string({ error: "TELEGRAM_BOT_TOKEN is required" })
    .min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_ALLOWED_CHAT_ID: z.coerce
    .number({ error: "TELEGRAM_ALLOWED_CHAT_ID must be a number" })
    .int({ error: "TELEGRAM_ALLOWED_CHAT_ID must be a number" }),
});

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const base = baseSchema.parse(env);
  const config: AppConfig = {
    transport: base.TRANSPORT,
    claudeModel: base.CLAUDE_MODEL,
    gardenSeed: base.GARDEN_SEED,
  };
  if (base.TRANSPORT === "telegram") {
    const telegram = telegramSchema.parse(env);
    config.telegram = {
      botToken: telegram.TELEGRAM_BOT_TOKEN,
      allowedChatId: telegram.TELEGRAM_ALLOWED_CHAT_ID,
    };
  }
  return config;
}
