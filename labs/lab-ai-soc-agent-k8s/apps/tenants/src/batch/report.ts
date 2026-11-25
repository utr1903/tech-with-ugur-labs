import type { Queryable } from "../db/pool.js";
import type { Logger } from "../logger.js";

export interface ReportRow {
  id: number;
  name: string;
  email: string;
  card_last4: string;
}

export function summarizeRows(rows: ReportRow[]): {
  rowCount: number;
  domains: string[];
} {
  const domains = new Set(rows.map((r) => r.email.split("@")[1] ?? ""));
  return { rowCount: rows.length, domains: [...domains].sort() };
}

export async function runReport(
  logger: Logger,
  pool: Queryable,
): Promise<void> {
  try {
    logger.info({}, "Running nightly report...");
    const { rows } = await pool.query<ReportRow>(
      "SELECT id, name, email, card_last4 FROM customers",
    );
    logger.info(summarizeRows(rows), "Running nightly report succeeded.");
  } catch (err) {
    logger.error({ err }, "Running nightly report failed.");
    throw err;
  }
}
