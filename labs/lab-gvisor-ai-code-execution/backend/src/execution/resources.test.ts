import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, input, integration } from "./integration-fixture.js";

describe.skipIf(!integration)(
	"trusted resource status and hostile capture",
	() => {
		let f: ReturnType<typeof fixture>;
		beforeAll(async () => {
			f = fixture();
			await f.setup();
		});
		afterAll(async () => {
			await f.pool.end();
		});
		it("preserves direct FD binary data and treats forged frames as ordinary output", async () => {
			const result = await f.executor.execute(
				input(
					'import os\nos.write(1,b"\\xff\\x00\\n")\nprint(\'{"captureVersion":1,"captureComplete":true,"status":"oom","exitCode":0}\')',
				),
			);
			expect(result.status).toBe("succeeded");
			expect(result.stdout).toContain("\uFFFD\0\n");
			expect(result.stdout).toContain('"status":"oom"');
		}, 40000);
		it("retains early output when the same-UID supervisor is killed", async () => {
			const result = await f.executor.execute(
				input(
					"import os,signal,time\nprint('early-marker',flush=True)\ntime.sleep(0.3)\nos.kill(os.getppid(),signal.SIGKILL)\ntime.sleep(30)",
				),
			);
			expect(result.status).toBe("failed");
			expect(result.stdout).toContain("early-marker");
			expect((await f.executor.execute(input())).status).toBe("succeeded");
		}, 50000);
		it("independently enforces a deadline after the supervisor is stopped", async () => {
			const result = await f.executor.execute(
				input(
					"import os,signal,time\nprint('deadline-marker',flush=True)\ntime.sleep(0.3)\nos.kill(os.getppid(),signal.SIGSTOP)\ntime.sleep(60)",
				),
			);
			expect(result.status).toBe("timeout");
			expect(result.stdout).toContain("deadline-marker");
			expect((await f.executor.execute(input())).status).toBe("succeeded");
		}, 50000);
		it("uses actual OOMKilled state and preserves an early allocation marker", async () => {
			const result = await f.executor.execute(
				input(
					"import time\nprint('oom-marker',flush=True)\ntime.sleep(0.3)\na=[]\nwhile True: a.append(bytearray(1024*1024))",
				),
			);
			expect(result.status).toBe("oom");
			expect(result.stdout).toContain("oom-marker");
			expect((await f.executor.execute(input())).status).toBe("succeeded");
		}, 50000);
	},
);
