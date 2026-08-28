import { describe, expect, it } from "bun:test";
import { isPermissionDenied } from "./errors";

describe("isPermissionDenied", () => {
	it("recognizes HTTP 403", () => {
		expect(
			isPermissionDenied(Object.assign(new Error("forbidden"), { code: 403 })),
		).toBe(true);
	});

	it("recognizes gRPC PERMISSION_DENIED (7)", () => {
		expect(
			isPermissionDenied(Object.assign(new Error("denied"), { code: 7 })),
		).toBe(true);
	});

	it("recognizes a nested forbidden reason", () => {
		const err = Object.assign(new Error("denied"), {
			errors: [{ reason: "forbidden" }],
		});
		expect(isPermissionDenied(err)).toBe(true);
	});

	it("rejects other errors", () => {
		expect(isPermissionDenied(new Error("boom"))).toBe(false);
		expect(
			isPermissionDenied(Object.assign(new Error("nf"), { code: 404 })),
		).toBe(false);
	});
});
