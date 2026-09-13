import { setTimeout as pause } from "node:timers/promises";
import type { Logger } from "../logger.js";
import type { Cluster, JobEvidence } from "./cluster.js";
import { post, type Response } from "./http.js";
import { assess, type Evidence } from "./report.js";
export type Mode = "insecure" | "secure";
type Attempt = {
  response: Response;
  jobs: JobEvidence[];
  elapsedMs: number;
};
export type Context = {
  cluster: Cluster;
  logger: Logger;
  checks: Evidence[];
  endpoints: Record<Mode, string>;
};
export function mergeJobs(
  old: Map<string, JobEvidence>,
  live: JobEvidence[],
): Map<string, JobEvidence> {
  for (const job of live) {
    if (!job.uid) continue;
    const previous = old.get(job.uid);
    old.set(job.uid, {
      ...job,
      pods: job.pods.length ? job.pods : (previous?.pods ?? []),
    });
  }
  return old;
}
export async function request(
  ctx: Context,
  mode: Mode,
  message: string,
  raw = false,
): Promise<Attempt> {
  const before = new Set(
    (await ctx.cluster.workers(mode)).map((job) => job.uid),
  );
  const captured = new Map<string, JobEvidence>();
  let settled = false;
  const started = Date.now();
  const pending = post(
    ctx.endpoints[mode],
    raw ? message : JSON.stringify({ message }),
  );
  // Attach both handlers immediately; observing does not change the response.
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  while (!settled) {
    mergeJobs(
      captured,
      (await ctx.cluster.workers(mode)).filter((job) => !before.has(job.uid)),
    );
    await pause(100);
  }
  const response = await pending;
  mergeJobs(
    captured,
    (await ctx.cluster.workers(mode)).filter((job) => !before.has(job.uid)),
  );
  const jobs = [...captured.values()].filter(
    (job) => !response.body.id || job.id === response.body.id,
  );
  return { response, jobs, elapsedMs: Date.now() - started };
}
export function record(ctx: Context, check: Evidence): boolean {
  check.passed = assess(check);
  ctx.checks.push(check);
  ctx.logger.info(
    {
      operation: check.operation,
      mode: check.mode,
      passed: check.passed,
      count: ctx.checks.length,
    },
    "Checking execution evidence completed.",
  );
  return check.passed;
}
export function checkAttempt(
  ctx: Context,
  mode: Mode,
  operation: string,
  expected: string,
  attempt: Attempt,
  passed: boolean,
  evidence: Record<string, unknown> = {},
): boolean {
  const { status, body } = attempt.response;
  return record(ctx, {
    operation,
    mode,
    expected,
    observed: {
      status,
      ...(body.exitCode !== undefined ? { exitCode: body.exitCode } : {}),
      ...(body.output !== undefined
        ? { output: body.output }
        : { output: body.error ?? "" }),
    },
    evidence: {
      execution: status !== 400,
      jobs: attempt.jobs,
      elapsedMs: attempt.elapsedMs,
      ...evidence,
    },
    passed,
  });
}
export async function benign(
  ctx: Context,
  mode: Mode,
  operation = "benign recovery",
): Promise<Attempt> {
  const attempt = await request(ctx, mode, "printf 'benign-recovery\\n'");
  checkAttempt(
    ctx,
    mode,
    operation,
    "HTTP 200, exit 0 and exact marker",
    attempt,
    attempt.response.status === 200 &&
      attempt.response.body.exitCode === 0 &&
      attempt.response.body.output === "benign-recovery\n",
  );
  return attempt;
}
export function outputPath(mode: Mode, id: string, extension = "md"): string {
  return mode === "secure"
    ? `/data/runs/${id}/${id}.${extension}`
    : `/data/${id}.${extension}`;
}
export const ownId =
  'id=$(node -p "JSON.parse(process.env.EXECUTION_CONFIG).id"); sleep 2; ';
