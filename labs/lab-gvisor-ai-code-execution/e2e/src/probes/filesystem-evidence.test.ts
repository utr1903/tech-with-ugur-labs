import { expect, it } from "vitest";
import { verifyCanaries } from "./filesystem-evidence.js";

it("requires independently present and unchanged fake values with no leaks", () => {
	const values = {
		app: "FAKE-app",
		database: "FAKE-db",
		secret: "FAKE-secret",
		host: "FAKE-host",
	};
	expect(verifyCanaries(values, values, values, "EXECUTED")).toHaveLength(4);
	for (const name of Object.keys(values)) {
		expect(() =>
			verifyCanaries(values, { ...values, [name]: "" }, values, "EXECUTED"),
		).toThrow();
		expect(() =>
			verifyCanaries(
				values,
				values,
				{ ...values, [name]: "changed" },
				"EXECUTED",
			),
		).toThrow();
		expect(() =>
			verifyCanaries(
				values,
				values,
				values,
				`EXECUTED ${values[name as keyof typeof values]}`,
			),
		).toThrow();
	}
});
it("refuses an omitted fake boundary", () => {
	expect(() =>
		verifyCanaries(
			{ app: "FAKE-a" },
			{ app: "FAKE-a" },
			{ app: "FAKE-a" },
			"EXECUTED",
		),
	).toThrow();
});
it("rejects a fake Secret value leaked in API base64 encoding", () => {
	const values = {
		app: "FAKE-app",
		database: "FAKE-db",
		secret: "FAKE-secret",
		host: "FAKE-host",
	};
	expect(() =>
		verifyCanaries(
			values,
			values,
			values,
			`EXECUTED ${Buffer.from(values.secret).toString("base64")}`,
		),
	).toThrow();
});
