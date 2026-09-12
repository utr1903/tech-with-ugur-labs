import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema.js";
export function createStore(databaseUrl: string) {
	const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
	const db = drizzle(pool, { schema });
	return {
		db,
		migrate: () =>
			migrate(db, {
				migrationsFolder: fileURLToPath(
					new URL("../../drizzle/", import.meta.url),
				),
			}),
		close: () => pool.end(),
	};
}
export type Store = ReturnType<typeof createStore>;
