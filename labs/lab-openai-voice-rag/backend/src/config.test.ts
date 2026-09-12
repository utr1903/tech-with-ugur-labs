import { expect, it } from "vitest";
import { readConfig } from "./config.js";

it("defaults to scripted and refuses live startup without credentials", () => {
	expect(readConfig({ DATABASE_URL: "postgres://local" }).mode).toBe(
		"scripted",
	);
	expect(() =>
		readConfig({ DATABASE_URL: "postgres://local", MODE: "live" }),
	).toThrow("OPENAI_API_KEY");
	expect(() =>
		readConfig({ DATABASE_URL: "postgres://local", MODE: "invalid" }),
	).toThrow("MODE");
});
