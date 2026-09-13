export type Evidence = {
  operation: string;
  mode: "insecure" | "secure" | "operator";
  expected: string;
  observed: { status?: number; exitCode?: number; output?: string };
  evidence: Record<string, unknown>;
  passed: boolean;
};
// Reject unsupported success claims and require positive/operator controls for denial evidence.
export function assess(check: Evidence): boolean {
  if (
    !check.passed ||
    Object.keys(check.observed).length === 0 ||
    Object.keys(check.evidence).length === 0
  )
    return false;
  const evidence = check.evidence;
  if (
    evidence.execution &&
    check.observed.status === 200 &&
    (!Number.isInteger(check.observed.exitCode) ||
      typeof check.observed.output !== "string")
  )
    return false;
  if (
    evidence.denial &&
    (evidence.positiveControl !== true || evidence.operatorConfirmed !== true)
  )
    return false;
  if (evidence.execution) {
    return observedJobs(evidence.jobs);
  }
  return true;
}
// A successful execution check needs real immutable Job and Pod identities.
function observedJobs(jobs: unknown): boolean {
  if (!Array.isArray(jobs) || jobs.length === 0) return false;
  return jobs.every(
    (job: { uid?: string; pods?: { uid?: string }[] }) =>
      Boolean(job.uid) &&
      Array.isArray(job.pods) &&
      job.pods.some((pod) => Boolean(pod.uid)),
  );
}
