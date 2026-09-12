import assert from "node:assert/strict";
import { runSource } from "../lib/jobs.js";
import type { Assertion } from "./report.js";
import { validateExecution } from "./report.js";
export async function resources(): Promise<Assertion[]> {
	const cases = [
		{
			name: "calculation",
			code: "print('EXECUTED'); print(6*7)",
			check: (r: Awaited<ReturnType<typeof runSource>>) => {
				assert.equal(r.exitCode, 0);
				assert(r.stdout.includes("42"));
			},
		},
		{
			name: "nonzero-stderr",
			code: "import sys; print('EXECUTED'); print('stderr-marker',file=sys.stderr); sys.exit(7)",
			check: (r: Awaited<ReturnType<typeof runSource>>) => {
				assert.equal(r.exitCode, 7);
				assert(r.stderr.includes("stderr-marker"));
			},
		},
		...[124, 137].map((exit) => ({
			name: `self-exit-${exit}`,
			code: `import sys; print('EXECUTED'); sys.exit(${exit})`,
			check: (r: Awaited<ReturnType<typeof runSource>>) => {
				assert.equal(r.exitCode, exit);
				assert.equal(r.reason, "Error");
			},
		})),
		{
			name: "cpu-wall-advisory",
			code: "print('EXECUTED',flush=True)\nwhile True: pass",
			check: (r: Awaited<ReturnType<typeof runSource>>) =>
				assert.equal(r.exitCode, 124),
		},
		{
			name: "oom",
			code: "import time; print('EXECUTED',flush=True); time.sleep(.5)\na=[]\nwhile True: a.append(bytearray(10000000))",
			check: (r: Awaited<ReturnType<typeof runSource>>) =>
				validateExecution({
					status: "oom",
					marker: r.stdout.includes("EXECUTED"),
					exitCode: r.exitCode,
					reason: r.reason,
				}),
		},
		{
			name: "deadline",
			code: "import os,signal,time; print('EXECUTED',flush=True); time.sleep(.5); os.kill(os.getppid(),signal.SIGSTOP); time.sleep(60)",
			check: (r: Awaited<ReturnType<typeof runSource>>) =>
				validateExecution({
					status: "timeout",
					marker: r.stdout.includes("EXECUTED"),
					exitCode: r.exitCode,
					reason: r.reason,
				}),
		},
		{
			name: "tmp",
			code: "import os\nprint('EXECUTED')\ntry:\n for n in range(3):\n  with open('/work/'+str(n),'wb') as f: f.write(b'x'*10000000)\nexcept OSError as e: print('errno',e.errno)\nprint(sum(os.stat('/work/'+n).st_size for n in os.listdir('/work')))",
			check: (r: Awaited<ReturnType<typeof runSource>>) =>
				assert(r.stdout.includes("errno 28")),
		},
		{
			name: "process",
			code: "import os,time\nprint('EXECUTED')\nkids=[]\ntry:\n for n in range(100):\n  p=os.fork()\n  if p==0: time.sleep(2); os._exit(0)\n  kids.append(p)\nexcept OSError as e: print('fork-denied',e.errno,len(kids),flush=True)\nfor p in kids: os.waitpid(p,0)",
			check: (r: Awaited<ReturnType<typeof runSource>>) =>
				assert(r.stdout.includes("fork-denied 11")),
		},
		{
			name: "output",
			code: "import os; print('EXECUTED',flush=True); os.write(1,b'x'*1000000); os.write(2,b'y'*1000000)",
			check: (r: Awaited<ReturnType<typeof runSource>>) => {
				assert.equal(Buffer.byteLength(r.stdout), 8192);
				assert.equal(Buffer.byteLength(r.stderr), 8192);
			},
		},
	];
	const assertions: Assertion[] = [];
	for (const c of cases) {
		const result = await runSource(c.code);
		assert(result.stdout.includes("EXECUTED"), "Source execution required.");
		c.check(result);
		assertions.push({
			name: c.name,
			layer: "Kubernetes/gVisor; same-UID runner advisory",
			attempted: c.name,
			status: "passed",
			evidence: {
				file: `${result.name}.json`,
				exitCode: result.exitCode,
				reason: result.reason,
			},
		});
	}
	return assertions;
}
