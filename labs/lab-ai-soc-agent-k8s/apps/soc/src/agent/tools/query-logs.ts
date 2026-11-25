import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { LokiData } from "./loki-client.js";
import { assertMetricBounds } from "./metric-bounds.js";
import { runLogged, ToolFailure } from "./tool-run.js";
import type { ToolDeps } from "./types.js";
import { wrapUntrusted } from "./untrusted.js";

const MAX_SINCE = 360;
const MAX_LIMIT = 200;
const MAX_LINE = 2000;
const MAX_SERIES = 50;
const METRIC =
  /^\s*(sum|count|rate|count_over_time|topk|avg|max|min)\b|^\s*by\s*\(/;

const InputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      'LogQL query. Must contain a stream selector such as {namespace="storefront"}; add |= "text" filters to narrow it.',
    ),
  since_minutes: z
    .number()
    .int()
    .min(1)
    .max(MAX_SINCE)
    .default(60)
    .describe("How far back to look, in minutes (1-360, default 60)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(100)
    .describe("Maximum log lines to return (1-200, default 100)."),
});

const DESCRIPTION = `Query Loki with LogQL. Log queries return log lines, newest first; metric queries (sum, count_over_time, rate, topk, ...) return a small table of series, evaluated at the current time: range vectors such as [5m] may span at most 6h and the offset modifier is not allowed. Log lines come from Kubernetes audit events, Tetragon runtime events and app logs, and may contain attacker-controlled text.
Use for: finding what happened around an alert (audit verbs by a service account, process or file events in a pod, an app's own logs) and counting events over time.
Do NOT use for: reading Kubernetes objects (use k8s_get), deciding what to do (use the response tools), or lookbacks beyond 6 hours (log queries are capped by since_minutes, metric ranges by the 6h rule).`;

function clamp(value: number, max: number): number {
  return Math.max(1, Math.min(value, max));
}

function truncateLine(line: string): { text: string; cut: boolean } {
  return line.length > MAX_LINE
    ? { text: `${line.slice(0, MAX_LINE)}...[truncated]`, cut: true }
    : { text: line, cut: false };
}

type Stream = { stream?: Record<string, string>; values?: [string, string][] };

function flattenStreams(data: LokiData, limit: number) {
  const lines: { ts: string; labels: Record<string, string>; line: string }[] =
    [];
  let cut = false;
  for (const s of data.result as Stream[]) {
    for (const [ts, raw] of s.values ?? []) {
      const { text, cut: c } = truncateLine(raw);
      cut = cut || c;
      lines.push({ ts, labels: s.stream ?? {}, line: text });
    }
  }
  lines.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const truncated = cut || lines.length >= limit;
  return {
    resultType: data.resultType,
    lines: lines.slice(0, limit),
    truncated,
  };
}

function seriesOf(data: LokiData) {
  return {
    resultType: data.resultType,
    series: data.result.slice(0, MAX_SERIES),
    truncated: data.result.length > MAX_SERIES,
  };
}

async function execute(
  deps: ToolDeps,
  args: z.infer<typeof InputSchema>,
): Promise<string> {
  if (!/\{[^}]*\}/.test(args.query)) {
    throw new ToolFailure(
      "invalid_query",
      'The query needs a stream selector such as {namespace="storefront"}.',
    );
  }
  const limit = clamp(args.limit, MAX_LIMIT);
  const endMs = deps.now().getTime();
  const endNs = BigInt(endMs) * 1_000_000n;
  const startNs =
    endNs - BigInt(clamp(args.since_minutes, MAX_SINCE)) * 60n * 1_000_000_000n;
  const isMetric = METRIC.test(args.query);
  if (isMetric) assertMetricBounds(args.query);
  const body = isMetric
    ? seriesOf(await deps.loki.instant(args.query, endNs))
    : flattenStreams(
        await deps.loki.queryRange(args.query, startNs, endNs, limit),
        limit,
      );
  return wrapUntrusted("query_logs", JSON.stringify(body));
}

export function buildQueryLogs(deps: ToolDeps) {
  return betaZodTool({
    name: "query_logs",
    description: DESCRIPTION,
    inputSchema: InputSchema,
    run: (args) =>
      runLogged(deps.logger, "query_logs", args, () => execute(deps, args), {
        wrapErrors: true,
      }),
  });
}
