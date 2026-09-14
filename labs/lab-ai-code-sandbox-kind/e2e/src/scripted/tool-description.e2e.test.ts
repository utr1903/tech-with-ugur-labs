import { describe, expect, it } from "vitest";
import { getTools } from "../support/chat-client.js";
import { getCapabilities } from "../support/sandbox-client.js";

describe("code_executor description", () => {
  it("names exactly the modules and limits the sandbox reports", async () => {
    const [tools, capabilities] = await Promise.all([
      getTools(),
      getCapabilities(),
    ]);
    expect(tools.llmMode).toBe("scripted");
    expect(tools.tools.map((t) => t.name)).toEqual(["code_executor"]);
    const description = tools.tools[0]?.description ?? "";

    const modulesLine =
      description
        .split("\n")
        .find((l) => l.startsWith("Installed modules: ")) ?? "";
    const described = modulesLine
      .replace("Installed modules: ", "")
      .replace(/\.$/, "")
      .split(", ");
    expect(described).toEqual(
      capabilities.modules.map(
        (m) => `${m.importName} (${m.distribution} ${m.version})`,
      ),
    );

    const { limits } = capabilities;
    expect(description).toContain(`Python ${capabilities.pythonVersion}`);
    expect(description).toContain(
      `timeout ${limits.executionTimeoutSeconds} s`,
    );
    expect(description).toContain(
      `stdout truncated after ${limits.maxStdoutBytes} bytes`,
    );
    expect(description).toContain(
      `stderr after ${limits.maxStderrBytes} bytes`,
    );
    expect(description).toContain(`code at most ${limits.maxCodeBytes} bytes`);
    expect(description).toContain(
      `at most ${limits.maxConcurrentExecutions} executions`,
    );
    expect(description).toContain("Use for:");
    expect(description).toContain("Do NOT use for:");
    for (const statement of [
      capabilities.network,
      capabilities.persistence,
      capabilities.structuredResult,
    ]) {
      expect(statement.length).toBeGreaterThan(0);
      expect(description).toContain(statement);
    }
  });
});
