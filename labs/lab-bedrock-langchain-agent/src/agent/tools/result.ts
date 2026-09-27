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

/** The largest value a Postgres `integer` id column can hold (see `db/schema.ts`). */
const MAX_ID = 2147483647;

/** Matches a whole, non-negative number written as plain digits, no sign, no decimal point, no exponent. */
const DIGITS_ONLY = /^\d+$/;

/**
 * A digit string longer than this can never convert to a safe integer (the
 * largest safe integer, `Number.MAX_SAFE_INTEGER`, has 16 digits), so it is
 * rejected up front instead of calling `Number()` on an arbitrarily long
 * string.
 */
const MAX_DIGIT_STRING_LENGTH = 15;

/**
 * Converts a value sent as a string of digits into a number, because at
 * least one Bedrock model sends numeric tool arguments as text (`"20"`
 * instead of `20`). A number is returned unchanged. A string is returned
 * unchanged, instead of being converted, when it is not purely digits, is
 * too long to be a safe integer, or would convert to a number that is not
 * a safe integer (`Number.isSafeInteger`) — for example
 * `"9007199254740993"` would silently become a different number
 * (`9007199254740992`) if converted, so it is left as text and the schema
 * piped after this rejects it as a string, the same clear message it
 * would give for any other wrong type.
 */
function digitsToNumber(value: number | string): number | string {
  if (typeof value === "number") return value;
  const trimmed = value.trim();
  if (!DIGITS_ONLY.test(trimmed) || trimmed.length > MAX_DIGIT_STRING_LENGTH) {
    return value;
  }
  const asNumber = Number(trimmed);
  return Number.isSafeInteger(asNumber) ? asNumber : value;
}

/**
 * Wraps a number schema so it also accepts a whole number sent as text.
 * The conversion happens once here and is reused by every numeric tool
 * field, instead of being repeated in each tool file. The custom error
 * message covers the case where the value is not a number or a string at
 * all (`true`, `[]`, `{}`), so the model learns what was expected instead
 * of a generic "Invalid input".
 */
function numericField<T extends z.ZodNumber>(finalSchema: T) {
  return z
    .union([z.number(), z.string()], { error: "expected a whole number" })
    .transform(digitsToNumber)
    .pipe(finalSchema);
}

/**
 * The zod field shared by every id filter (`id`, `customer_id`,
 * `product_id`): a positive whole number up to the largest id the
 * database can store, or that same number sent as text. `null` and
 * omission both mean "not set".
 */
export function positiveIntegerField(description: string) {
  return numericField(z.number().int().positive().max(MAX_ID))
    .nullish()
    .describe(description);
}

/** The `limit` field shared by the three tool schemas. */
export const limitField = numericField(z.number().int().min(1).max(MAX_LIMIT))
  .nullish()
  .transform((value) => value ?? DEFAULT_LIMIT)
  .describe(
    `Maximum whole number of rows to return, 1 to ${MAX_LIMIT}. Defaults to ${DEFAULT_LIMIT}. The result field "total" always counts all matching rows.`,
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
