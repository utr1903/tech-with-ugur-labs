import { mkdir, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { join } from "node:path";
import { Cluster } from "../e2e/cluster.js";
import { concurrencyChecks } from "../e2e/concurrency.js";
import { type Context, record } from "../e2e/context.js";
import { controlChecks } from "../e2e/controls.js";
import { failureChecks } from "../e2e/failures.js";
import { observedWorkerChecks } from "../e2e/live-controls.js";
import { networkChecks } from "../e2e/network.js";
import { retentionChecks } from "../e2e/retention.js";
import { storageChecks } from "../e2e/storage.js";
import { operation } from "../lib/operation.js";
import { createLogger, installGlobalErrorHandlers } from "../logger.js";
import { prerequisites } from "./prerequisites.js";
import { createRunner } from "./process.js";
import { root, versions } from "./settings.js";

const logger = createLogger({ appName: "job-isolation-e2e" });
installGlobalErrorHandlers(logger);
const run = createRunner(logger);
const ctx: Context = {
  cluster: new Cluster(run),
  logger,
  checks: [],
  endpoints: {
    insecure: "http://127.0.0.1:3000",
    secure: "http://127.0.0.1:3001",
  },
};
const report = {
  platform: {
    os: platform(),
    architecture: arch(),
    release: release(),
    node: process.version,
  },
  versions: { ...versions, node: process.version },
  checks: ctx.checks,
  passed: false,
};
// Save local evidence privately after probe groups and even if later infrastructure fails.
async function save() {
  await mkdir(join(root, "artifacts"), { recursive: true, mode: 0o700 });
  await writeFile(
    join(root, "artifacts/e2e-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
}
await operation(
  logger,
  "Verifying deployed executions",
  {},
  async () => {
    try {
      await prerequisites(run);
      // Establish live image/runtime/operator controls before interpreting worker access denials.
      await controlChecks(ctx);
      await save();
      const seeds = await storageChecks(ctx);
      await save();
      await networkChecks(ctx);
      await save();
      await failureChecks(ctx, seeds);
      await save();
      await concurrencyChecks(ctx);
      await save();
      // Run retention last because it intentionally prunes earlier completed results and Jobs.
      await retentionChecks(ctx);
      await observedWorkerChecks(ctx);
      // Require all recorded assertions, including supporting identity evidence, to pass.
      report.passed =
        ctx.checks.length > 0 && ctx.checks.every((check) => check.passed);
      if (!report.passed) process.exitCode = 1;
      // Record an explicit incomplete-run failure rather than letting a partial report imply success.
    } catch (err) {
      record(ctx, {
        operation: "E2E infrastructure failure",
        mode: "operator",
        expected: "all probes complete with supporting evidence",
        observed: {
          output: "E2E could not complete; see safe structured diagnostics.",
        },
        evidence: { completedChecks: ctx.checks.length },
        passed: false,
      });
      throw err;
      // Persist the final or partial evidence on both successful and failed runs.
    } finally {
      await save();
    }
  },
  () => ({
    count: ctx.checks.length,
    passed: report.passed,
    report: "artifacts/e2e-report.json",
  }),
);
