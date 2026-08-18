import type { Pool } from "pg";
import type { Logger } from "../logger.js";

export type Migration = {
  id: number;
  name: string;
  sql: string;
};

export const migrations: Migration[] = [
  {
    id: 1,
    name: "init-messages",
    sql: `
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO messages (body)
      SELECT 'hello from schema v1'
      WHERE NOT EXISTS (SELECT 1 FROM messages);
    `,
  },
  {
    id: 2,
    name: "add-author",
    sql: `
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS author TEXT NOT NULL DEFAULT 'anonymous';
      INSERT INTO messages (body, author)
      SELECT 'hello from schema v2', 'flux'
      WHERE NOT EXISTS (SELECT 1 FROM messages WHERE author = 'flux');
    `,
  },
];

export function pendingMigrations(
  applied: number[],
  target: number,
): Migration[] {
  return migrations
    .filter(
      (migration) => migration.id <= target && !applied.includes(migration.id),
    )
    .sort((a, b) => a.id - b.id);
}

export async function runMigrations(
  pool: Pool,
  target: number,
  logger: Logger,
): Promise<number> {
  const client = await pool.connect();
  try {
    logger.info({ target }, "Running migrations...");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id INT PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const result = await client.query(
      "SELECT id FROM schema_migrations ORDER BY id",
    );
    const applied = result.rows.map((row: { id: number }) => row.id);
    const pending = pendingMigrations(applied, target);
    for (const migration of pending) {
      logger.info(
        { id: migration.id, name: migration.name },
        "Applying migration...",
      );
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (id, name) VALUES ($1, $2)",
          [migration.id, migration.name],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
      logger.info({ id: migration.id }, "Applying migration succeeded.");
    }
    logger.info(
      { appliedCount: pending.length },
      "Running migrations succeeded.",
    );
    return pending.length;
  } catch (err) {
    logger.error({ err, target }, "Running migrations failed.");
    throw err;
  } finally {
    client.release();
  }
}

export async function waitForDb(
  pool: Pool,
  logger: Logger,
  attempts = 30,
  delayMs = 2000,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (attempt === attempts) {
        logger.error({ err, attempts }, "Waiting for database failed.");
        throw err;
      }
      logger.warn({ attempt, attempts }, "Waiting for database...");
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
