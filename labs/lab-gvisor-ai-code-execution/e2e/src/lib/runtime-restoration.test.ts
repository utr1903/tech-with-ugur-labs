import { expect, it } from "vitest";
import { withRuntimeRestoration } from "./runtime-restoration.js";

it("restores and restarts after deletion failure while retaining both failures", async () => {
	const drillError = new Error("drill");
	const deletionError = new Error("delete");
	const calls: string[] = [];
	const result = withRuntimeRestoration(
		async () => {
			throw drillError;
		},
		() => {
			calls.push("delete");
			throw deletionError;
		},
		() => {
			calls.push("restore");
		},
		() => {
			calls.push("restart");
		},
	);
	await expect(result).rejects.toMatchObject({
		errors: [drillError, deletionError],
	});
	expect(calls).toEqual(["delete", "restore", "restart"]);
});
it("attempts restart even when restoring configuration fails", async () => {
	const calls: string[] = [];
	const failure = new Error("restore");
	await expect(
		withRuntimeRestoration(
			async () => {},
			() => {},
			() => {
				throw failure;
			},
			() => {
				calls.push("restart");
			},
		),
	).rejects.toMatchObject({ errors: [failure] });
	expect(calls).toEqual(["restart"]);
});
