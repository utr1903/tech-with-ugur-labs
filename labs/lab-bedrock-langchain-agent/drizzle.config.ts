import { defineConfig } from "drizzle-kit";

/** Tells drizzle-kit where the schema is and where to write migrations. */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
