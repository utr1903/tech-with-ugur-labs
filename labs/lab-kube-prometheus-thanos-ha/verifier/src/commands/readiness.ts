import type { Ctx } from "../context.js";
import { pollUntil } from "../lib/poll.js";
import { singleValue } from "../prom/compare.js";

const NODE_COUNT = 3;

// Proof 0: both stacks answer, Thanos sees all 4 sidecars, and every raw
// series carries the replica label that dedup relies on.
export async function runReadiness(ctx: Ctx): Promise<void> {
  const logger = ctx.logger.child({ command: "readiness" });
  try {
    logger.info("Checking readiness...");
    await pollUntil({
      logger,
      description: "vanilla Prometheus sees all node-exporter targets",
      timeoutSeconds: 180,
      intervalSeconds: 5,
      attempt: async () => {
        const n = singleValue(
          await ctx.vanilla.instantQuery('count(up{job="node-exporter"} == 1)'),
        );
        if (n !== NODE_COUNT)
          throw new Error(`vanilla sees ${n}/${NODE_COUNT} node-exporters`);
      },
    });
    await pollUntil({
      logger,
      description: "all 4 Thanos sidecar stores are healthy",
      timeoutSeconds: 180,
      intervalSeconds: 5,
      attempt: async () => {
        const stores = await ctx.thanos.sidecarStores();
        const unhealthy = stores.filter((s) => s.lastError !== null);
        if (stores.length !== 4 || unhealthy.length > 0) {
          throw new Error(
            `stores: ${stores.length}/4, unhealthy: ${JSON.stringify(unhealthy)}`,
          );
        }
      },
    });
    await pollUntil({
      logger,
      description: "Thanos Query sees all node-exporter targets",
      timeoutSeconds: 180,
      intervalSeconds: 5,
      attempt: async () => {
        const n = singleValue(
          await ctx.thanos.instantQuery('count(up{job="node-exporter"} == 1)', {
            dedup: true,
            partialResponse: false,
          }),
        );
        if (n !== NODE_COUNT)
          throw new Error(`thanos sees ${n}/${NODE_COUNT} node-exporters`);
      },
    });
    const raw = await ctx.thanos.instantQuery('up{job="node-exporter"}', {
      dedup: false,
    });
    const unlabeled = raw.filter((s) => !s.metric.prometheus_replica);
    if (unlabeled.length > 0) {
      throw new Error(
        `${unlabeled.length} raw series lack the prometheus_replica external label`,
      );
    }
    logger.info({ rawSeries: raw.length }, "Checking readiness succeeded.");
  } catch (err) {
    logger.error({ err }, "Checking readiness failed.");
    throw err;
  }
}
