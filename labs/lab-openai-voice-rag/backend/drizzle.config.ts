import { defineConfig } from "drizzle-kit";
export default defineConfig({
	dialect: "postgresql",
	schema: "./src/corpus/schema.ts",
	out: "./drizzle",
	dbCredentials: {
		url:
			process.env.DATABASE_URL ??
			"postgresql://voice_rag:local-development-only@postgres:5432/voice_rag",
	},
});
