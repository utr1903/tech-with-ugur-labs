import { expect, it } from "vitest";
import { validateExecution } from "./report.js";

it("refuses source-labelled success when trusted termination is nonzero", () => {
	expect(() =>
		validateExecution({
			status: "succeeded",
			marker: true,
			exitCode: 7,
			reason: "Error",
		}),
	).toThrow();
});
