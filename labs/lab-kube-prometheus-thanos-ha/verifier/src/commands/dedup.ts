import { NODE_COUNT } from "../constants.js";
import type { Ctx } from "../context.js";
import { pollUntil } from "../lib/poll.js";
import type { InstantSample } from "../prom/client.js";

// Raw view: every instance appears once per replica of its owning shard (2).
// Deduped view: every instance appears exactly once.
export function analyzeDedup(
  raw: InstantSample[],
  deduped: InstantSample[],
): void {
  const replicasByInstance = new Map<string, Set<string>>();
  for (const s of raw) {
    const instance = s.metric.instance ?? "unknown";
    const replica = s.metric.prometheus_replica ?? "missing";
    const set = replicasByInstance.get(instance) ?? new Set<string>();
    set.add(replica);
    replicasByInstance.set(instance, set);
  }
  if (replicasByInstance.size !== NODE_COUNT) {
    throw new Error(
      `raw view covers ${replicasByInstance.size} instances, expected exactly ${NODE_COUNT}`,
    );
  }
  for (const [instance, replicas] of replicasByInstance) {
    if (replicas.size !== 2) {
      throw new Error(
        `instance ${instance} has ${replicas.size} distinct replicas in the raw view, expected 2 distinct replicas`,
      );
    }
  }
  const seen = new Set<string>();
  for (const s of deduped) {
    const instance = s.metric.instance ?? "unknown";
    if (seen.has(instance))
      throw new Error(
        `instance ${instance} must appear exactly once after dedup`,
      );
    seen.add(instance);
  }
  if (seen.size !== replicasByInstance.size) {
    throw new Error(
      `deduped instances (${seen.size}) != raw instances (${replicasByInstance.size})`,
    );
  }
}

// Proof 3: replication doubles every series; Thanos' replica-label dedup
// collapses the pairs back into one logical series.
export async function runDedup(ctx: Ctx): Promise<void> {
  const logger = ctx.logger.child({ command: "dedup" });
  try {
    logger.info("Checking replica deduplication...");
    await pollUntil({
      logger,
      description: "raw series are duplicated per replica and deduped once",
      timeoutSeconds: 120,
      intervalSeconds: 10,
      attempt: async () => {
        const raw = await ctx.thanos.instantQuery('up{job="node-exporter"}', {
          dedup: false,
          partialResponse: false,
        });
        const deduped = await ctx.thanos.instantQuery(
          'up{job="node-exporter"}',
          { dedup: true, partialResponse: false },
        );
        logger.info(
          { raw: raw.length, deduped: deduped.length },
          "Measured series counts.",
        );
        analyzeDedup(raw, deduped);
      },
    });
    logger.info("Checking replica deduplication succeeded.");
  } catch (err) {
    logger.error({ err }, "Checking replica deduplication failed.");
    throw err;
  }
}
