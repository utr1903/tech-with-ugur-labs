import type { Pool } from "pg";
export async function setupThreads(pool: Pool) {
	await pool.query(`CREATE TABLE IF NOT EXISTS chat_threads(id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
 CREATE TABLE IF NOT EXISTS chat_turns(thread_id uuid REFERENCES chat_threads(id), id text NOT NULL, request jsonb NOT NULL, status text NOT NULL CHECK(status IN ('active','done','error')), deadline timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(thread_id,id));
 CREATE UNIQUE INDEX IF NOT EXISTS chat_active_thread ON chat_turns(thread_id) WHERE status='active';
 CREATE TABLE IF NOT EXISTS chat_messages(thread_id uuid REFERENCES chat_threads(id), id text NOT NULL, role text NOT NULL, text text NOT NULL, ordinal bigserial, PRIMARY KEY(thread_id,id));
 CREATE TABLE IF NOT EXISTS chat_actions(thread_id uuid NOT NULL, turn_id text NOT NULL, step integer NOT NULL CHECK(step BETWEEN 0 AND 2), action jsonb NOT NULL CHECK(octet_length(action::text)<=65536), PRIMARY KEY(thread_id,turn_id,step));
 CREATE TABLE IF NOT EXISTS chat_events(thread_id uuid NOT NULL, turn_id text NOT NULL, key text NOT NULL, sequence bigserial, event json NOT NULL CHECK(octet_length(event::text)<=131072), PRIMARY KEY(thread_id,turn_id,key));
 ALTER TABLE chat_events ALTER COLUMN event TYPE json USING event::json;
 ALTER TABLE chat_events DROP CONSTRAINT IF EXISTS chat_events_event_check;
 ALTER TABLE chat_events ADD CONSTRAINT chat_events_event_check CHECK(octet_length(event::text)<=131072);`);
}
