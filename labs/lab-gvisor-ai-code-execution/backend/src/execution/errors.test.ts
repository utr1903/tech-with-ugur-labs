import pino from "pino";
import { expect, it } from "vitest";
import { logError } from "./errors.js";

it("does not copy database detail or attacker output into structured error logs", () => {
	const err = Object.assign(new Error("attacker-output"), {
		detail: "secret-in-query",
		where: "source-text",
	});
	const logged = JSON.stringify(pino.stdSerializers.err(logError(err)));
	expect(logged).not.toContain("attacker-output");
	expect(logged).not.toContain("secret-in-query");
	expect(logged).not.toContain("source-text");
});
