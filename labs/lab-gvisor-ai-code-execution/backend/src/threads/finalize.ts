import type { PoolClient } from "pg";
export async function finalize(
	client: PoolClient,
	threadId: string,
	turnId: string,
	status: "done" | "error",
) {
	await client.query("BEGIN");
	try {
		await client.query(
			"INSERT INTO chat_events(thread_id,turn_id,key,event) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
			[
				threadId,
				turnId,
				status,
				JSON.stringify(
					status === "done"
						? { type: "done" }
						: {
								type: "error",
								message: "Turn failed or exceeded its deadline.",
							},
				),
			],
		);
		await client.query(
			"UPDATE chat_turns SET status=$3 WHERE thread_id=$1 AND id=$2",
			[threadId, turnId, status],
		);
		await client.query("COMMIT");
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	}
}
