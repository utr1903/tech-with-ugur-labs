import type pg from "pg";
import type { Logger } from "../logger.js";

export type TableChecksums = Record<string, string>;

const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

// One deterministic checksum per table: hash every row's text
// representation, then hash the sorted concatenation. Sorting by the
// row hash makes the result independent of physical row order, so two
// databases with the same logical content always produce the same
// checksum — which is exactly the property a restore must reproduce.
export function buildTableChecksumQuery(table: string): string {
  if (!IDENTIFIER_PATTERN.test(table)) {
    throw new Error(`Unsafe table name: ${table}`);
  }
  return `
    SELECT md5(coalesce(string_agg(row_hash, ',' ORDER BY row_hash), 'empty')) AS checksum
    FROM (SELECT md5(t::text) AS row_hash FROM ${table} t) rows
  `;
}

export async function computeTableChecksums(
  client: pg.Client,
  tables: readonly string[],
  logger: Logger,
): Promise<TableChecksums> {
  try {
    logger.info({ tables }, "Computing table checksums...");
    const checksums: TableChecksums = {};
    for (const table of tables) {
      const result = await client.query(buildTableChecksumQuery(table));
      checksums[table] = result.rows[0].checksum;
    }
    logger.info({ checksums }, "Computing table checksums succeeded.");
    return checksums;
  } catch (err) {
    logger.error({ err, tables }, "Computing table checksums failed.");
    throw err;
  }
}

export function diffChecksums(a: TableChecksums, b: TableChecksums): string[] {
  const tables = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...tables].filter((table) => a[table] !== b[table]).sort();
}
