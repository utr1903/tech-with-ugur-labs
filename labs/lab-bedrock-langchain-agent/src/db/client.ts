import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

/** The typed database handle passed to everything that reads or writes. */
export type Database = NodePgDatabase<typeof schema>;

/**
 * Opens a connection pool. The pool is returned as well so the caller that
 * opened it can close it.
 */
export function createDatabase(url: string): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url });
  return { db: drizzle(pool, { schema }), pool };
}
