import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Executor } from "./execute.js";
import { fixture, input, integration } from "./integration-fixture.js";
import { Ledger } from "./ledger.js";

describe.skipIf(!integration)("real Kubernetes durable execution", () => {
	let f: ReturnType<typeof fixture>;
	beforeAll(async () => {
		f = fixture();
		await f.setup();
	});
	afterAll(async () => {
		await f.pool.end();
	});
	it("executes once and replays the stored result after executor restart", async () => {
		const args = input();
		const first = await f.executor.execute(args);
		expect(first.status).toBe("succeeded");
		expect(first.stdout).toBe("42\n");
		const again = await new Executor(f.pool, f.api, f.logger).execute(args);
		expect(again).toEqual(first);
		expect(await f.api.getJob(`exec-${first.executionId}`)).toBeNull();
		await expect(
			f.executor.execute({ ...args, source: "print(43)" }),
		).rejects.toThrow(/conflict/i);
		expect(await new Ledger(f.pool).outstanding()).toHaveLength(0);
	}, 40000);
	it.each([124, 137])(
		"does not treat source-selected exit %i as trusted resource failure",
		async (code) => {
			const result = await f.executor.execute(
				input(`import sys\nprint('marker',flush=True)\nsys.exit(${code})`),
			);
			expect(result.status).toBe("failed");
			expect(result.exitCode).toBe(code);
			expect(result.stdout).toContain("marker");
		},
		40000,
	);
	it("returns both full capped streams and advisory flood truncation", async () => {
		const result = await f.executor.execute(
			input("import os\nos.write(1,b'A'*8192)\nos.write(2,b'B'*8192)"),
		);
		expect(result.status).toBe("succeeded");
		expect(result.stdout.length).toBe(8192);
		expect(result.stderr.length).toBe(8192);
		const flood = await f.executor.execute(
			input("import os\nos.write(1,b'F'*1000000)"),
		);
		expect(flood.stdout.length).toBe(8192);
		expect(flood.runnerReportedTruncation).toBe(true);
	}, 60000);
});
