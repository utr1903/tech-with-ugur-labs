import { z } from "zod";
import type { Database } from "../../db/client.js";
import type { Logger } from "../../logger.js";

/** What every tool needs to do its work. */
export type ToolDeps = { db: Database; logger: Logger };

/** The transaction handle drizzle passes to a transaction callback. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * The one shape all three tools return, so the model learns it once. Errors
 * are values, not exceptions: one failed query must not end the whole run.
 */
type ToolResult<Row> =
  | { ok: true; rows: Row[]; total: number; truncated: boolean }
  | { ok: false; error: { code: "DATABASE_ERROR"; message: string } };

/** Makes Postgres itself refuse writes inside a tool query. */
export const READ_ONLY = { accessMode: "read only" } as const;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** The `limit` field shared by the three tool schemas. */
export const limitField = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .nullish()
  .transform((value) => value ?? DEFAULT_LIMIT)
  .describe(
    `Maximum number of rows to return, 1 to ${MAX_LIMIT}. Defaults to ${DEFAULT_LIMIT}. The result field "total" always counts all matching rows.`,
  );

/**
 * Runs one tool query in a read-only transaction and returns the result as
 * JSON text. `total` is counted separately so a counting question is
 * answered correctly even when the rows were cut off by the limit.
 */
export async function readRows<Row>({
  db,
  logger,
  tool,
  limit,
  query,
  count,
}: ToolDeps & {
  tool: string;
  limit: number;
  query: (tx: Transaction, limit: number) => Promise<Row[]>;
  count: (tx: Transaction) => Promise<number>;
}): Promise<string> {
  let result: ToolResult<Row>;
  try {
    result = await db.transaction(async (tx) => {
      const rows = await query(tx, limit);
      const total = await count(tx);
      return { ok: true as const, rows, total, truncated: total > rows.length };
    }, READ_ONLY);
  } catch (err) {
    // Deliberately not re-thrown: the model gets a structured error and can
    // try again. The details stay in the log and are not sent to the model.
    logger.error({ err, tool }, "Reading rows failed.");
    result = {
      ok: false,
      error: {
        code: "DATABASE_ERROR",
        message: "The database query failed. Try again or use other filters.",
      },
    };
  }
  return JSON.stringify(result);
}
