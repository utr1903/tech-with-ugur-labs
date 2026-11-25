import { describe, expect, it, vi } from "vitest";
import type { LokiClient } from "./loki-client.js";
import { buildQueryLogs } from "./query-logs.js";
import {
  asText,
  descriptionOf,
  FIXED_NOW,
  makeDeps,
  unwrapJson,
} from "./test-support.js";

const NOW_NS = BigInt(FIXED_NOW.getTime()) * 1_000_000n;

function lokiWith(partial: Partial<LokiClient>): LokiClient {
  return {
    queryRange: async () => ({ resultType: "streams", result: [] }),
    instant: async () => ({ resultType: "vector", result: [] }),
    ...partial,
  };
}

describe("query_logs", () => {
  it("clamps since_minutes to 360 and limit to 200", async () => {
    const queryRange = vi.fn(async () => ({
      resultType: "streams",
      result: [],
    }));
    const tool = buildQueryLogs(makeDeps({ loki: lokiWith({ queryRange }) }));
    await tool.run({ query: '{ns="a"}', since_minutes: 5000, limit: 9999 });
    expect(queryRange).toHaveBeenCalledWith(
      '{ns="a"}',
      NOW_NS - 360n * 60n * 1_000_000_000n,
      NOW_NS,
      200,
    );
  });

  it("derives the time window from the injected clock", async () => {
    const queryRange = vi.fn(async () => ({
      resultType: "streams",
      result: [],
    }));
    const tool = buildQueryLogs(makeDeps({ loki: lokiWith({ queryRange }) }));
    await tool.run({ query: '{ns="a"}', since_minutes: 10, limit: 20 });
    expect(queryRange).toHaveBeenCalledWith(
      '{ns="a"}',
      NOW_NS - 600_000_000_000n,
      NOW_NS,
      20,
    );
  });

  it("routes metric queries to the instant endpoint", async () => {
    const instant = vi.fn(async () => ({
      resultType: "vector",
      result: [{ metric: { ns: "a" }, value: [1, "3"] }],
    }));
    const tool = buildQueryLogs(makeDeps({ loki: lokiWith({ instant }) }));
    const out = unwrapJson(
      await tool.run({
        query: 'sum by (ns) (count_over_time({ns="a"}[5m]))',
        since_minutes: 60,
        limit: 100,
      }),
    ) as { resultType: string; series: unknown[] };
    expect(instant).toHaveBeenCalledWith(
      expect.stringContaining("count_over_time"),
      NOW_NS,
    );
    expect(out.resultType).toBe("vector");
    expect(out.series).toHaveLength(1);
  });

  it("returns flattened lines, truncating long ones", async () => {
    const long = "x".repeat(2500);
    const queryRange = async () => ({
      resultType: "streams",
      result: [
        { stream: { ns: "a" }, values: [["1700000000000000000", long]] },
      ],
    });
    const tool = buildQueryLogs(makeDeps({ loki: lokiWith({ queryRange }) }));
    const out = unwrapJson(
      await tool.run({ query: '{ns="a"}', since_minutes: 60, limit: 100 }),
    ) as {
      lines: { line: string; labels: Record<string, string> }[];
      truncated: boolean;
    };
    expect(out.lines[0]?.line.length).toBeLessThan(2100);
    expect(out.lines[0]?.labels).toEqual({ ns: "a" });
    expect(out.truncated).toBe(true);
  });

  it("rejects a query without a stream selector", async () => {
    const tool = buildQueryLogs(makeDeps());
    const out = JSON.parse(
      asText(await tool.run({ query: "error", since_minutes: 60, limit: 100 })),
    );
    expect(out.error.code).toBe("invalid_query");
  });

  it("returns a structured error when Loki is unreachable", async () => {
    const queryRange = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const tool = buildQueryLogs(makeDeps({ loki: lokiWith({ queryRange }) }));
    const out = JSON.parse(
      asText(
        await tool.run({ query: '{ns="a"}', since_minutes: 60, limit: 100 }),
      ),
    );
    expect(out.error.code).toBe("tool_failed");
    expect(out.error.message).toContain("ECONNREFUSED");
  });

  it("documents when to use and not use it", () => {
    const tool = buildQueryLogs(makeDeps());
    expect(descriptionOf(tool)).toContain("Use for:");
    expect(descriptionOf(tool)).toContain("Do NOT use for:");
  });
});
