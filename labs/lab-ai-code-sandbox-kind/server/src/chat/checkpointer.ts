import { setTimeout as sleep } from "node:timers/promises";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { Logger } from "../logger.js";

// Postgres may still be starting when the server pod starts; retry setup().
export async function createCheckpointer({
  databaseUrl,
  logger,
  attempts = 30,
  delayMs = 2_000,
}: {
  databaseUrl: string;
  logger: Logger;
  attempts?: number;
  delayMs?: number;
}): Promise<PostgresSaver> {
  const checkpointer = PostgresSaver.fromConnString(databaseUrl);
  logger.info({ attempts }, "Setting up checkpointer...");
  for (let attempt = 1; ; attempt += 1) {
    try {
      await checkpointer.setup();
      logger.info({ attempt }, "Setting up checkpointer succeeded.");
      return checkpointer;
    } catch (err) {
      if (attempt >= attempts) {
        logger.error({ err, attempt }, "Setting up checkpointer failed.");
        throw err;
      }
      logger.warn({ err, attempt }, "Postgres not ready yet; retrying.");
      await sleep(delayMs);
    }
  }
}
