export type CustomerRow = { full_name: string; email: string };
export type Queryable = {
  query(sql: string): Promise<{ rows: CustomerRow[] }>;
};

// DELIBERATELY VULNERABLE: the user-supplied `q` is concatenated straight into
// the SQL. A parameterized query ($1) would close this hole — and defeat the
// lab. The base query selects two text columns so a UNION payload lines up.
export function buildSearchSql(q: string): string {
  return `SELECT full_name, email FROM customers WHERE full_name ILIKE '%${q}%' ORDER BY id`;
}

export async function searchCustomers(
  pool: Queryable,
  q: string,
): Promise<CustomerRow[]> {
  const { rows } = await pool.query(buildSearchSql(q));
  return rows;
}
