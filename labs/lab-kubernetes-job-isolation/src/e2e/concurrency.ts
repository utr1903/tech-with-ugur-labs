import { setTimeout as pause } from "node:timers/promises";
import type { JobEvidence } from "./cluster.js";
import {
  benign,
  type Context,
  checkAttempt,
  record,
  request,
} from "./context.js";
// Treat Pending and Running Pods as occupying execution slots during sampling.
export function activeCount(jobs: JobEvidence[]): number {
  return jobs.filter((job) =>
    job.pods.some((pod) => pod.phase === "Pending" || pod.phase === "Running"),
  ).length;
}
// Submit three long-enough commands together and sample live Jobs while the third waits for a slot.
export async function concurrencyChecks(ctx: Context) {
  for (const mode of ["insecure", "secure"] as const) {
    const before = new Set(
      (await ctx.cluster.workers(mode)).map((job) => job.uid),
    );
    const samples: { elapsedMs: number; active: number }[] = [];
    const started = Date.now();
    let done = false;
    const pending = Promise.all(
      [0, 1, 2].map((index) =>
        request(ctx, mode, `sleep 4; printf 'concurrent-${index}\\n'`),
      ),
    );
    void pending.then(
      () => {
        done = true;
      },
      () => {
        done = true;
      },
    );
    while (!done) {
      const active = activeCount(
        (await ctx.cluster.workers(mode)).filter((job) => !before.has(job.uid)),
      );
      samples.push({ elapsedMs: Date.now() - started, active });
      await pause(150);
    }
    const attempts = await pending;
    const good = attempts.map((attempt, index) =>
      checkAttempt(
        ctx,
        mode,
        `concurrent request ${index}`,
        "HTTP200 with exact distinct marker",
        attempt,
        attempt.response.status === 200 &&
          attempt.response.body.exitCode === 0 &&
          attempt.response.body.output === `concurrent-${index}\n`,
      ),
    );
    const maximum = Math.max(...samples.map((sample) => sample.active));
    const elapsed = attempts
      .map((attempt) => attempt.elapsedMs)
      .sort((a, b) => a - b);
    record(ctx, {
      operation: "two-slot bounded concurrency",
      mode,
      expected: "at most two active Jobs; third request waits and succeeds",
      observed: {
        output: `maximum-active=${maximum}; durations=${elapsed.join(",")}`,
      },
      evidence: {
        execution: true,
        jobs: attempts.flatMap((attempt) => attempt.jobs),
        samples,
        maximum,
        requestDurationsMs: elapsed,
        noRetries: attempts.every((attempt) =>
          attempt.jobs.every(
            (job) => job.backoffLimit === 0 && job.pods.length === 1,
          ),
        ),
      },
      passed:
        good.every(Boolean) &&
        maximum === 2 &&
        (elapsed[2] ?? 0) - (elapsed[0] ?? 0) >= 3000,
    });
    await benign(ctx, mode, "recovery after queued concurrent requests");
  }
}
