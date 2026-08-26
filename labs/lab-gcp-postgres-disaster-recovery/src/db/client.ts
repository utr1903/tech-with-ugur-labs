import pg from "pg";
import type { DrillConfig } from "../config.js";
import type { Logger } from "../logger.js";

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function connectDb(
  config: DrillConfig,
  logger: Logger,
): Promise<pg.Client> {
  try {
    logger.info(
      { host: config.dbHost, database: config.dbName },
      "Connecting to Postgres...",
    );
    const client = new pg.Client({
      host: config.dbHost,
      port: config.dbPort,
      database: config.dbName,
      user: config.dbUser,
      password: config.dbPassword,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15_000,
    });
    await client.connect();
    logger.info({ host: config.dbHost }, "Connecting to Postgres succeeded.");
    return client;
  } catch (err) {
    logger.error(
      { err, host: config.dbHost },
      "Connecting to Postgres failed.",
    );
    throw err;
  }
}

// After an in-place restore the instance drops every connection and is
// briefly unreachable even once it reports RUNNABLE, so the reconnect
// path retries with a fixed delay instead of failing fast.
export async function connectDbWithRetry(
  config: DrillConfig,
  logger: Logger,
  opts: {
    attempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<pg.Client> {
  const { attempts = 12, delayMs = 10_000, sleep = defaultSleep } = opts;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await connectDb(config, logger);
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        logger.warn(
          { attempt, attempts, delayMs },
          "Connecting to Postgres failed; retrying...",
        );
        await sleep(delayMs);
      }
    }
  }
  throw lastErr;
}
