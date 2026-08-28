import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const BASE = { ANTHROPIC_API_KEY: "test-key" };

describe("loadConfig", () => {
  it("defaults transport to telegram and requires telegram vars", () => {
    const config = loadConfig({
      ...BASE,
      TELEGRAM_BOT_TOKEN: "tok",
      TELEGRAM_ALLOWED_CHAT_ID: "1234",
    });
    expect(config.transport).toBe("telegram");
    expect(config.telegram).toEqual({ botToken: "tok", allowedChatId: 1234 });
    expect(config.claudeModel).toBe("claude-haiku-4-5");
    expect(config.gardenSeed).toBe(42);
  });

  it("script transport needs no telegram vars", () => {
    const config = loadConfig({ ...BASE, TRANSPORT: "script" });
    expect(config.transport).toBe("script");
    expect(config.telegram).toBeUndefined();
  });

  it("honors CLAUDE_MODEL and GARDEN_SEED overrides", () => {
    const config = loadConfig({
      ...BASE,
      TRANSPORT: "script",
      CLAUDE_MODEL: "claude-sonnet-5",
      GARDEN_SEED: "7",
    });
    expect(config.claudeModel).toBe("claude-sonnet-5");
    expect(config.gardenSeed).toBe(7);
  });

  it("rejects a missing ANTHROPIC_API_KEY", () => {
    expect(() => loadConfig({ TRANSPORT: "script" })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it("rejects telegram transport without a bot token", () => {
    expect(() =>
      loadConfig({ ...BASE, TELEGRAM_ALLOWED_CHAT_ID: "1234" }),
    ).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("rejects telegram transport without an allowed chat id", () => {
    expect(() => loadConfig({ ...BASE, TELEGRAM_BOT_TOKEN: "tok" })).toThrow(
      /TELEGRAM_ALLOWED_CHAT_ID/,
    );
  });

  it("rejects a non-numeric allowed chat id", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        TELEGRAM_BOT_TOKEN: "tok",
        TELEGRAM_ALLOWED_CHAT_ID: "not-a-number",
      }),
    ).toThrow(/TELEGRAM_ALLOWED_CHAT_ID/);
  });
});
