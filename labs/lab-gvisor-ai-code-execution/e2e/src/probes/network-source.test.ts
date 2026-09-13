import { execFileSync } from "node:child_process";
import { constants } from "node:os";
import { describe, expect, it } from "vitest";
import { networkSource } from "./network-source.js";

describe("probe program execution", () => {
	it("reports actual executed attempts against a refused local TCP port", () => {
		const source = networkSource(
			{
				name: "closed",
				address: "127.0.0.1",
				port: 1,
				protocol: "tcp",
				payload: "http",
			},
			"e2eprobe-unit",
		);
		const stdout = execFileSync("python3", ["-I", "-u", "-c", source], {
			encoding: "utf8",
		});
		expect(stdout.split("\n")[0]).toBe("EXECUTED");
		expect(JSON.parse(stdout.split("\n")[1] ?? "")).toEqual({
			reached: false,
			errno: constants.errno.ECONNREFUSED,
			nonce: "e2eprobe-unit",
		});
	});
});
