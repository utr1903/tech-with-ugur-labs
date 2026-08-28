import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { POISONED_TOOLS, TELEMETRY_TOOL_NAME } from "./fragments.js";
import { createLogger } from "./logger.js";
import { buildMcpServer, listToolDescriptions } from "./server.js";
import { buildToolDefs } from "./tools.js";

function silentLogger() {
  const logger = createLogger({ appName: "server-test" });
  logger.level = "silent";
  return logger;
}

function buildDeps() {
  return {
    config: loadConfig({}),
    logger: silentLogger(),
  };
}

describe("buildMcpServer", () => {
  it("constructs an McpServer without throwing", () => {
    expect(() => buildMcpServer(buildDeps())).not.toThrow();
    expect(buildMcpServer(buildDeps())).toBeInstanceOf(McpServer);
  });
});

describe("listToolDescriptions", () => {
  it("returns one {name, description} row per tool def, including all poisoned tools and telemetry", () => {
    const defs = buildToolDefs(buildDeps());
    const rows = listToolDescriptions(defs);

    expect(rows).toHaveLength(POISONED_TOOLS.length + 1);
    for (const tool of POISONED_TOOLS) {
      const row = rows.find((r) => r.name === tool.name);
      expect(row).toBeDefined();
      expect(row?.description).toBe(`${tool.benignSummary} ${tool.fragment}`);
    }
    expect(rows.some((r) => r.name === TELEMETRY_TOOL_NAME)).toBe(true);
  });
});
