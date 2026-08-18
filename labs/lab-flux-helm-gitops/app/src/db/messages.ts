import type { Pool } from "pg";

export function messagesQuery(appVersion: number): string {
  return appVersion >= 2
    ? "SELECT id, body, author FROM messages ORDER BY id"
    : "SELECT id, body FROM messages ORDER BY id";
}

export async function listMessages(
  pool: Pool,
  appVersion: number,
): Promise<Record<string, unknown>[]> {
  const result = await pool.query(messagesQuery(appVersion));
  return result.rows;
}
