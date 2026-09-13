import pg from "pg";
export function createPool(connectionString: string): pg.Pool {
	return new pg.Pool({
		connectionString,
		max: 12,
		connectionTimeoutMillis: 2000,
		idleTimeoutMillis: 10000,
		statement_timeout: 3000,
		query_timeout: 4000,
	});
}
