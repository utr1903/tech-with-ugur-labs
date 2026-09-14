import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { execute } from "../support/sandbox-client.js";

const CONCURRENT = 20;
const SLEEP_SECONDS = 1.5;

function canaryProgram(canary: string): string {
  return [
    "import json, os, random, time",
    `canary = ${JSON.stringify(canary)}`,
    `time.sleep(${SLEEP_SECONDS} + random.random() * 0.5)`,
    "print(canary)",
    'json.dump({"canary": canary}, open("result.json", "w"))',
    'open("canary-" + canary, "w").write(canary)',
    "try:",
    '    siblings = os.listdir("..")',
    "except PermissionError:",
    '    siblings = "denied"',
    'print(json.dumps({"cwd": os.getcwd(), "files": sorted(os.listdir(".")), "siblings": siblings}))',
  ].join("\n");
}

describe("per-request isolation", () => {
  it("runs 20 requests concurrently and each sees only its own canary", async () => {
    const canaries = Array.from({ length: CONCURRENT }, () => randomUUID());
    const started = Date.now();
    const runs = await Promise.all(
      canaries.map((c) => execute(canaryProgram(c))),
    );
    const wallMs = Date.now() - started;

    // Serial execution would take at least 20 × 1.5 s = 30 s.
    expect(wallMs).toBeLessThan(12_000);
    const cwds = new Set<string>();
    runs.forEach((run, i) => {
      const own = canaries[i] as string;
      expect(run.status).toBe("succeeded");
      expect(run.stderr).toBe("");
      expect(run.result).toEqual({ canary: own });
      const [printed, report] = run.stdout.trim().split("\n");
      expect(printed).toBe(own);
      const details = JSON.parse(report as string) as {
        cwd: string;
        files: string[];
        siblings: unknown;
      };
      expect(details.files).toEqual([
        `canary-${own}`,
        "main.py",
        "result.json",
      ]);
      expect(details.siblings).toBe("denied");
      cwds.add(details.cwd);
      for (const other of canaries) {
        if (other !== own) expect(JSON.stringify(run)).not.toContain(other);
      }
    });
    expect(cwds.size).toBe(CONCURRENT);
  });

  it("does not share interpreter state between executions", async () => {
    const earlier = await execute(
      "import builtins\nbuiltins.LEFTOVER = 'from an earlier run'\nprint(hasattr(builtins, 'LEFTOVER'))",
    );
    expect(earlier.stdout).toBe("True\n");
    const later = await execute(
      "import builtins\nprint(hasattr(builtins, 'LEFTOVER'))",
    );
    expect(later.stdout).toBe("False\n");
  });

  it("removes an execution's working directory before the next one runs", async () => {
    const first = await execute(
      "import os\nopen('marker', 'w').write('x')\nprint(os.getcwd(), os.path.exists('marker'))",
    );
    const [earlier, markerWritten] = first.stdout.trim().split(" ");
    expect(markerWritten).toBe("True");
    const later = await execute(
      `import os\nprint(os.path.exists(${JSON.stringify(earlier)}), os.path.exists(${JSON.stringify(`${earlier}/marker`)}))`,
    );
    expect(later.stdout).toBe("False False\n");
  });
});
