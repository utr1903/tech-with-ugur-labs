import type { V1Pod } from "@kubernetes/client-node";
import type { List } from "./cluster.js";
import {
  benign,
  type Context,
  checkAttempt,
  type Mode,
  outputPath,
  request,
} from "./context.js";
// Enumerate the run directory and both mode-specific result files expected to be removed.
export function cleanupPaths(mode: Mode, id: string): string[] {
  return [
    `/data/runs/${id}`,
    outputPath(mode, id),
    outputPath(mode, id, "exit"),
  ];
}
// Require independent absence of the Job, matching Pods and every expected storage path.
export function cleanupProven(
  jobDeleted: boolean,
  podUids: string[],
  expected: string[],
  observed: { path: string; exists: boolean }[],
): boolean {
  return (
    jobDeleted &&
    podUids.length === 0 &&
    expected.length === 3 &&
    observed.length === expected.length &&
    expected.every((path) =>
      observed.some((entry) => entry.path === path && entry.exists === false),
    )
  );
}
// Outlive the Job deadline, then independently list resources and inspect storage before recovery.
export async function timeoutCheck(ctx: Context, mode: Mode) {
  const attempt = await request(
    ctx,
    mode,
    "sleep 45; printf 'must-not-run\\n'",
  );
  const [jobs, pods] = await Promise.all([
    ctx.cluster.workers(mode),
    ctx.cluster.get<List<V1Pod>>(mode, "pods"),
  ]);
  const id = attempt.jobs[0]?.id;
  const deleted =
    attempt.jobs.length === 1 &&
    !jobs.some((job) => job.uid === attempt.jobs[0]?.uid);
  const observedPodUids = new Set(
    attempt.jobs.flatMap((job) => job.pods.map((pod) => pod.uid)),
  );
  const remainingPods = pods.items
    .filter(
      (pod) =>
        (Boolean(id) && pod.metadata?.labels?.["execution-id"] === id) ||
        observedPodUids.has(pod.metadata?.uid),
    )
    .map((pod) => ({
      uid: pod.metadata?.uid ?? "unknown",
      name: pod.metadata?.name,
      executionId: pod.metadata?.labels?.["execution-id"],
      phase: pod.status?.phase,
    }));
  const paths = id ? cleanupPaths(mode, id) : [];
  const remaining = await ctx.cluster.node<{
    paths: { path: string; exists: boolean }[];
  }>(
    mode,
    `const fs=require('node:fs'); process.stdout.write(JSON.stringify({paths:${JSON.stringify(paths)}.map(path=>({path,exists:fs.existsSync(path)}))}));`,
  );
  checkAttempt(
    ctx,
    mode,
    "Job deadline and awaited deletion",
    "HTTP504 within total60s; actual Job and independently listed Pods/result files/run directory removed",
    attempt,
    attempt.response.status === 504 &&
      attempt.response.body.error === "Execution timed out." &&
      attempt.elapsedMs < 65000 &&
      cleanupProven(
        deleted,
        remainingPods.map((pod) => pod.uid),
        paths,
        remaining.paths,
      ) &&
      attempt.jobs.every(
        (job) => job.backoffLimit === 0 && job.pods.length === 1,
      ),
    {
      actualJobDeleted: deleted,
      independentlyListedRemainingPods: remainingPods,
      observedPodUids: [...observedPodUids],
      outputPaths: remaining.paths,
      jobDeadlineSeconds: 30,
      totalDeadlineSeconds: 60,
    },
  );
  await benign(ctx, mode, "recovery after Job deadline");
}
