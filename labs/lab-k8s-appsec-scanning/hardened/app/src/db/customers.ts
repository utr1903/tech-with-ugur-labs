export type CustomerRow = { full_name: string; email: string };
export type Queryable = {
  query(sql: string, params: string[]): Promise<{ rows: CustomerRow[] }>;
};

// Parameterized: user input travels as a bound value ($1), never as SQL text.
export function buildSearchSql(q: string): { text: string; values: string[] } {
  return {
    text: "SELECT full_name, email FROM customers WHERE full_name ILIKE $1 ORDER BY id",
    values: [`%${q}%`],
  };
}

export async function searchCustomers(
  pool: Queryable,
  q: string,
): Promise<CustomerRow[]> {
  const { text, values } = buildSearchSql(q);
  const { rows } = await pool.query(text, values);
  return rows;
}
