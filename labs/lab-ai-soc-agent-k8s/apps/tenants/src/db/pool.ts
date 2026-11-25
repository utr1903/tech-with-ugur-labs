import pg from "pg";
import type { Logger } from "../logger.js";

export interface Queryable {
  query<Row>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

export function createPool(logger: Logger): pg.Pool {
  const host = process.env.DB_HOST ?? "postgres.payments.svc";
  const database = process.env.DB_NAME ?? "payments";
  const user = process.env.DB_USER;
  logger.info({ host, database, user }, "Creating database pool...");
  const pool = new pg.Pool({
    host,
    database,
    user,
    port: Number(process.env.DB_PORT ?? 5432),
    password: process.env.DB_PASSWORD,
    max: 4,
  });
  logger.info({ host, database, user }, "Creating database pool succeeded.");
  return pool;
}
