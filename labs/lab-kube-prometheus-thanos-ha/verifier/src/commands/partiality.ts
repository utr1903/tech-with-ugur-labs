import type { Ctx } from "../context.js";
import { pollUntil } from "../lib/poll.js";
import { singleValue } from "../prom/compare.js";

export function assertPartiality({
  shard0,
  shard1,
  total,
}: {
  shard0: number;
  shard1: number;
  total: number;
}): void {
  if (shard0 < 1 || shard1 < 1) {
    throw new Error(
      `each shard must scrape at least 1 target (shard0=${shard0}, shard1=${shard1})`,
    );
  }
  if (shard0 >= total || shard1 >= total) {
    throw new Error(
      `each shard must see a strict subset (shard0=${shard0}, shard1=${shard1}, total=${total})`,
    );
  }
  if (shard0 + shard1 !== total) {
    throw new Error(
      `shard counts must sum to the total (${shard0}+${shard1} != ${total})`,
    );
  }
}

// Proof 2: each shard only knows its slice of the target list, while Thanos
// Query sees the union — the reason naive sharding breaks querying.
export async function runPartiality(ctx: Ctx): Promise<void> {
  const logger = ctx.logger.child({ command: "partiality" });
  try {
    logger.info("Checking shard partiality...");
    await pollUntil({
      logger,
      description: "shard target counts partition the Thanos total",
      timeoutSeconds: 180,
      intervalSeconds: 10,
      attempt: async () => {
        const shard0 = singleValue(await ctx.shard0.instantQuery("count(up)"));
        const shard1 = singleValue(await ctx.shard1.instantQuery("count(up)"));
        const total = singleValue(
          await ctx.thanos.instantQuery("count(up)", {
            dedup: true,
            partialResponse: false,
          }),
        );
        logger.info({ shard0, shard1, total }, "Measured target counts.");
        assertPartiality({ shard0, shard1, total });
      },
    });
    logger.info("Checking shard partiality succeeded.");
  } catch (err) {
    logger.error({ err }, "Checking shard partiality failed.");
    throw err;
  }
}
