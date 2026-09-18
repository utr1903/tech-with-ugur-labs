import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { execInDeployment } from "../support/cluster.js";
import {
  type CapabilitiesDoc,
  execute,
  expectHealthy,
  getCapabilities,
  postExecute,
} from "../support/sandbox-client.js";

let capabilities: CapabilitiesDoc;

beforeAll(async () => {
  capabilities = await getCapabilities();
});

describe("sandbox API", () => {
  it("lists every promised module with a version the interpreter actually imports", async () => {
    const names = capabilities.modules.map((m) => m.importName);
    expect(names).toEqual(["numpy", "pandas", "scipy", "sympy", "sklearn"]);
    const code = `import importlib, json\nprint(json.dumps({n: importlib.import_module(n).__version__ for n in ${JSON.stringify(names)}}))`;
    const run = await execute(code);
    expect(run.status).toBe("succeeded");
    expect(JSON.parse(run.stdout)).toEqual(
      Object.fromEntries(
        capabilities.modules.map((m) => [m.importName, m.version]),
      ),
    );
  });

  it("solves a linear system with exact stdout and a parsed result", async () => {
    const run = await execute(
      [
        "import json, numpy as np",
        "x = np.linalg.solve([[2, 1, 1], [1, 3, 2], [3, 2, 1]], [13, 19, 18])",
        "values = [round(float(v), 6) for v in x]",
        "print(values)",
        'json.dump({"x": values}, open("result.json", "w"))',
      ].join("\n"),
    );
    expect(run).toMatchObject({
      status: "succeeded",
      exitCode: 0,
      stdout: "[3.0, 2.0, 5.0]\n",
      stderr: "",
      result: { x: [3, 2, 5] },
      resultError: null,
      truncated: false,
    });
  });

  describe("failures", () => {
    afterEach(async () => {
      await expectHealthy();
    });

    it("reports an exception as failed with its traceback", async () => {
      const run = await execute("raise ValueError('boom')");
      expect(run.status).toBe("failed");
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("Traceback");
      expect(run.stderr).toContain("ValueError: boom");
    });

    it("times out an infinite loop within the limit and leaves no process behind", async () => {
      const limitMs = capabilities.limits.executionTimeoutSeconds * 1000;
      const started = Date.now();
      const run = await execute(
        "import os, subprocess, sys\nchild = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(600)'])\nprint(os.getpid(), child.pid, flush=True)\nwhile True:\n    pass",
      );
      const elapsed = Date.now() - started;
      expect(run.status).toBe("timed_out");
      expect(run.exitCode).toBeNull();
      expect(elapsed).toBeGreaterThanOrEqual(limitMs);
      expect(elapsed).toBeLessThan(limitMs + 10_000);
      const pids = run.stdout.trim().split(/\s+/);
      expect(pids).toHaveLength(2);
      const check = await execInDeployment("sandbox", [
        "python",
        "-c",
        `import os, sys; sys.exit(1 if any(os.path.exists('/proc/' + p) for p in ${JSON.stringify(pids)}) else 0)`,
      ]);
      expect(check.code).toBe(0);
    });

    it("truncates oversized output", async () => {
      const run = await execute(
        `import sys; sys.stdout.write('x' * ${capabilities.limits.maxStdoutBytes * 3})`,
      );
      expect(run.status).toBe("succeeded");
      expect(run.truncated).toBe(true);
      expect(run.stdout.length).toBe(capabilities.limits.maxStdoutBytes);
    });

    it("reports an invalid result.json instead of crashing", async () => {
      const run = await execute("open('result.json', 'w').write('{not json')");
      expect(run).toMatchObject({
        status: "succeeded",
        result: null,
        resultError: "result.json is not valid JSON",
      });
    });

    it.each([
      ["not json", "not json"],
      ["an empty object", "{}"],
      ["empty code", JSON.stringify({ code: "" })],
      ["a non-string code", JSON.stringify({ code: 42 })],
      ["an unknown field", JSON.stringify({ code: "print(1)", shell: true })],
    ])("rejects %s with 400", async (_label, body) => {
      const response = await postExecute(body);
      expect(response.status).toBe(400);
      expect(response.json).toMatchObject({ error: "invalid_request" });
    });

    it("rejects code over the size limit with 400", async () => {
      const response = await postExecute(
        JSON.stringify({
          code: `# ${"a".repeat(capabilities.limits.maxCodeBytes)}`,
        }),
      );
      expect(response.status).toBe(400);
      expect(response.json).toMatchObject({ error: "invalid_request" });
    });

    it("answers 429 immediately when every slot is busy", async () => {
      const marker = randomUUID();
      const sleepers = Array.from(
        { length: capabilities.limits.maxConcurrentExecutions },
        () =>
          postExecute(
            JSON.stringify({
              code: `import time\ntime.sleep(8)\nprint('${marker}')`,
            }),
          ),
      );
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      const busy = await postExecute(JSON.stringify({ code: "print(1)" }));
      expect(busy.status).toBe(429);
      expect(busy.json).toMatchObject({ error: "sandbox_busy" });
      expect(busy.retryAfter).toBe("1");
      expect(busy.elapsedMs).toBeLessThan(1_000);
      const finished = await Promise.all(sleepers);
      expect(finished.every((r) => r.status === 200)).toBe(true);
    });
  });
});
