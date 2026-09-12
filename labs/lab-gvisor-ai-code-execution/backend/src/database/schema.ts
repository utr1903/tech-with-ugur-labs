import type { Pool } from "pg";
export async function setupDatabase(pool: Pool): Promise<void> {
	await pool.query(`CREATE TABLE IF NOT EXISTS executions (
 id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
 thread_id text NOT NULL, turn_id text NOT NULL, tool_call_id text NOT NULL,
 source text NOT NULL, source_hash text NOT NULL, template_hash text NOT NULL,
 phase text NOT NULL CHECK (phase IN ('reserved','submitting','observed','terminal')),
 held boolean NOT NULL, job_uid text, pod_uid text, fence integer NOT NULL DEFAULT 0,
 deadline timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 seconds',
 lease_until timestamptz, result json, log_budget integer NOT NULL DEFAULT 32768 CHECK(log_budget BETWEEN 0 AND 32768),
 UNIQUE(thread_id,turn_id,tool_call_id)
 ); CREATE UNIQUE INDEX IF NOT EXISTS execution_thread_slot ON executions(thread_id) WHERE held;`);
}
