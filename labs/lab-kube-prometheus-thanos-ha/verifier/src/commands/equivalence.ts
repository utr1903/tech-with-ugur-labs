import type { Ctx } from "../context.js";
import { pollUntil } from "../lib/poll.js";
import { approxEqual, singleValue } from "../prom/compare.js";

type EquivalenceCheck = {
  name: string;
  query: string;
  kind: "exact" | "approx";
};
type Measured = {
  name: string;
  kind: "exact" | "approx";
  vanilla: number;
  thanos: number;
};

// Every query aggregates over the cluster itself (nodes, kubelet cgroups) —
// never over the monitoring pipelines, whose target sets legitimately differ.
export const EQUIVALENCE_CHECKS: EquivalenceCheck[] = [
  { name: "node-count", query: "count(node_uname_info)", kind: "exact" },
  {
    name: "node-exporter-targets",
    query: 'count(up{job="node-exporter"} == 1)',
    kind: "exact",
  },
  {
    name: "total-memory",
    query: "sum(node_memory_MemTotal_bytes)",
    kind: "exact",
  },
  {
    name: "available-memory",
    query: "sum(node_memory_MemAvailable_bytes)",
    kind: "approx",
  },
  {
    name: "cpu-busy-rate",
    query: 'sum(rate(node_cpu_seconds_total{mode!="idle"}[2m]))',
    kind: "approx",
  },
  {
    name: "kube-system-container-cpu",
    query:
      'sum(rate(container_cpu_usage_seconds_total{namespace="kube-system"}[2m]))',
    kind: "approx",
  },
];

const APPROX = { relTol: 0.15, absTol: 0.05 };
const EXACT = { relTol: 0, absTol: 0 };

export function verdicts(measured: Measured[]): string[] {
  const failures: string[] = [];
  for (const m of measured) {
    const tol = m.kind === "exact" ? EXACT : APPROX;
    if (!approxEqual(m.vanilla, m.thanos, tol)) {
      failures.push(
        `${m.name}: vanilla=${m.vanilla} thanos=${m.thanos} (${m.kind})`,
      );
    }
  }
  return failures;
}

async function measureAll(ctx: Ctx, timeSec: number): Promise<Measured[]> {
  const out: Measured[] = [];
  for (const check of EQUIVALENCE_CHECKS) {
    const vanilla = singleValue(
      await ctx.vanilla.instantQuery(check.query, { time: timeSec }),
    );
    const thanos = singleValue(
      await ctx.thanos.instantQuery(check.query, {
        time: timeSec,
        dedup: true,
        partialResponse: false,
      }),
    );
    out.push({ name: check.name, kind: check.kind, vanilla, thanos });
  }
  return out;
}

// Proof 1: the vanilla stack and the Thanos-fronted stack answer the same
// questions with the same numbers, evaluated at one shared timestamp.
export async function runEquivalence(ctx: Ctx): Promise<void> {
  const logger = ctx.logger.child({ command: "equivalence" });
  try {
    logger.info(
      { checks: EQUIVALENCE_CHECKS.length },
      "Checking answer equivalence...",
    );
    await pollUntil({
      logger,
      description: "vanilla and Thanos agree on every check",
      timeoutSeconds: 300, // rate[2m] needs a couple of minutes of samples first
      intervalSeconds: 15,
      attempt: async () => {
        const timeSec = Math.floor(Date.now() / 1000 / 15) * 15 - 30;
        const measured = await measureAll(ctx, timeSec);
        const failures = verdicts(measured);
        logger.info({ timeSec, measured }, "Measured one equivalence round.");
        if (failures.length > 0)
          throw new Error(`equivalence failures: ${failures.join("; ")}`);
      },
    });
    logger.info("Checking answer equivalence succeeded.");
  } catch (err) {
    logger.error({ err }, "Checking answer equivalence failed.");
    throw err;
  }
}
