import pg from "pg";
import type { AppConfig } from "../config.js";

export function createPool(db: AppConfig["db"]): pg.Pool {
  return new pg.Pool({
    host: db.host,
    port: db.port,
    database: db.database,
    user: db.user,
    password: db.password,
  });
}
