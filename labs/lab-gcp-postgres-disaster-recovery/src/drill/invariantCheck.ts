import type pg from "pg";
import type { Logger } from "../logger.js";

export type InvariantResult = {
  corruptedRows: number;
  grandTotalDriftCents: number;
  holds: boolean;
};

// Row-level: a value-preserving conversion must keep total = qty * unit.
const ROW_INVARIANT_QUERY =
  "SELECT count(*)::int AS corrupted FROM orders WHERE total_eur <> quantity * unit_price_eur";

// Ledger-level: converting cents to euros must not change the grand
// total recorded in control_totals before the migration ran.
const GRAND_TOTAL_DRIFT_QUERY = `
  SELECT (SELECT grand_total_cents FROM control_totals WHERE id = 1)
       - (SELECT round(sum(total_eur) * 100)::bigint FROM orders) AS drift_cents
`;

export function evaluateInvariant(
  corruptedRows: number,
  grandTotalDriftCents: number,
): InvariantResult {
  return {
    corruptedRows,
    grandTotalDriftCents,
    holds: corruptedRows === 0 && grandTotalDriftCents === 0,
  };
}

export async function checkInvariants(
  client: pg.Client,
  logger: Logger,
): Promise<InvariantResult> {
  try {
    logger.info("Checking post-migration invariants...");
    const rowResult = await client.query(ROW_INVARIANT_QUERY);
    const driftResult = await client.query(GRAND_TOTAL_DRIFT_QUERY);
    const result = evaluateInvariant(
      rowResult.rows[0].corrupted,
      Number(driftResult.rows[0].drift_cents),
    );
    logger.info({ ...result }, "Checking post-migration invariants succeeded.");
    return result;
  } catch (err) {
    logger.error({ err }, "Checking post-migration invariants failed.");
    throw err;
  }
}
