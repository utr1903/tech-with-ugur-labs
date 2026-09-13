import { randomUUID } from "node:crypto";
import type { JobEvidence } from "./cluster.js";
import {
  benign,
  type Context,
  checkAttempt,
  outputPath,
  record,
  request,
} from "./context.js";
import { post, type Response } from "./http.js";
import { workerBound } from "./live-controls.js";
export function completeCoverage(
  ids: (string | undefined)[],
  jobs: JobEvidence[],
): boolean {
  if (
    ids.length !== 130 ||
    new Set(ids).size !== 130 ||
    ids.some((id) => !id) ||
    jobs.length !== 130 ||
    new Set(jobs.map((job) => job.uid)).size !== 130
  )
    return false;
  return (
    ids.every((id) => jobs.filter((job) => job.id === id).length === 1) &&
    jobs.every(workerBound)
  );
}
export function retentionBound(
  completed: number,
  retained: number,
  sentinelFile: boolean,
  sentinelJob: boolean,
): boolean {
  return completed > 128 && retained === 128 && !sentinelFile && !sentinelJob;
}
export async function retentionChecks(ctx: Context) {
  for (const mode of ["insecure", "secure"] as const) {
    const sentinel = await request(ctx, mode, "printf 'retention-sentinel\\n'");
    checkAttempt(
      ctx,
      mode,
      "retention sentinel",
      "exact marker captured before exceeding retention cap",
      sentinel,
      sentinel.response.status === 200 &&
        sentinel.response.body.output === "retention-sentinel\n",
    );
    const responses: Response[] = [];
    let firstPair: JobEvidence[] = [];
    const marker = `retention-${randomUUID()}\n`;
    // Batches of two honor the same public concurrency limit. Every filler is a real POST/Job.
    for (let offset = 0; offset < 130; offset += 2) {
      responses.push(
        ...(await Promise.all(
          [0, 1].map(() =>
            post(
              ctx.endpoints[mode],
              JSON.stringify({ message: `printf '${marker}'` }),
            ),
          ),
        )),
      );
      if (offset === 0) {
        const firstIds = new Set(responses.map((response) => response.body.id));
        firstPair = (await ctx.cluster.workers(mode)).filter((job) =>
          firstIds.has(job.id),
        );
      }
      if (offset % 20 === 0)
        ctx.logger.info(
          { mode, completed: responses.length },
          "Checking retention progress succeeded.",
        );
    }
    const ids = new Set(responses.map((response) => response.body.id));
    const jobs = (await ctx.cluster.workers(mode)).filter((job) =>
      ids.has(job.id),
    );
    const historicalJobs = [...firstPair, ...jobs];
    const sentinelId = sentinel.response.body.id;
    const sentinelFile = sentinelId
      ? await ctx.cluster.node<{ exists: boolean }>(
          mode,
          `process.stdout.write(JSON.stringify({exists:require('node:fs').existsSync(${JSON.stringify(outputPath(mode, sentinelId))})}));`,
        )
      : { exists: true };
    const sentinelJob = (await ctx.cluster.workers(mode)).some(
      (job) => job.id === sentinelId,
    );
    const successful = responses.filter(
      (response) =>
        response.status === 200 &&
        response.body.exitCode === 0 &&
        response.body.output === marker,
    ).length;
    const files = await ctx.cluster.node<{
      retained: number;
      allRegularAndBounded: boolean;
    }>(
      mode,
      `const fs=require('node:fs'); const ids=${JSON.stringify([...ids])}; const paths=ids.map(id=>${mode === "secure" ? "'/data/runs/'+id+'/'+id+'.md'" : "'/data/'+id+'.md'"}); const present=paths.filter(path=>fs.existsSync(path)); process.stdout.write(JSON.stringify({retained:present.length,allRegularAndBounded:present.every(path=>{const stat=fs.lstatSync(path);return stat.isFile()&&stat.size<=65536;})}));`,
    );
    record(ctx, {
      operation: "actual server-lifetime retention cap",
      mode,
      expected:
        "130 successful executions leave latest128 results/Jobs; older sentinel deleted",
      observed: {
        output: `successful=${successful};retainedJobs=${jobs.length};retainedFiles=${files.retained};sentinelFile=${sentinelFile.exists};sentinelJob=${sentinelJob}`,
      },
      evidence: {
        execution: true,
        jobs: historicalJobs,
        firstPairCapturedBeforePruning: firstPair.map((job) => ({
          id: job.id,
          uid: job.uid,
          podUids: job.pods.map((pod) => pod.uid),
        })),
        currentlyRetainedJobUids: jobs.map((job) => job.uid),
        observedWorkerCount: historicalJobs.length,
        sentinel: sentinel.jobs,
        responses,
        retainedFiles: files,
        sentinelFileExists: sentinelFile.exists,
        sentinelJobExists: sentinelJob,
        limit: 128,
        ageLimitSeconds: 3600,
        ageEvidence:
          "live Job TTL3600 plus deterministic CompletedExecutions age-pruning unit tests; not a one-hour live wait",
        restartLimitation:
          "bookkeeping in memory; pre-restart PVC files remain until teardown",
      },
      passed:
        retentionBound(
          successful,
          jobs.length,
          sentinelFile.exists,
          sentinelJob,
        ) &&
        files.retained === 128 &&
        files.allRegularAndBounded &&
        completeCoverage(
          responses.map((response) => response.body.id),
          historicalJobs,
        ),
    });
    await benign(ctx, mode, "recovery after retention pruning");
  }
}
