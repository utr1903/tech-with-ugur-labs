import pg from "pg";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

export function createPool(db: AppConfig["db"], logger: Logger): pg.Pool {
  const pool = new pg.Pool({
    host: db.host,
    port: db.port,
    database: db.database,
    user: db.user,
    password: db.password,
  });
  pool.on("error", (err) => {
    logger.error({ err }, "Postgres pool error.");
  });
  return pool;
}
