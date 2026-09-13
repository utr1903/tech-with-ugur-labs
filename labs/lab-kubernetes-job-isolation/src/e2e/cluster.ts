import type { V1Job, V1Pod, V1PodSpec } from "@kubernetes/client-node";
import type { Runner } from "../commands/process.js";
export type List<T> = { items: T[] };
export type JobEvidence = ReturnType<typeof summarize>;
// Collect operator evidence through the explicit lab context, independent of worker claims.
export class Cluster {
  constructor(private readonly runner: Runner) {}
  async get<T>(namespace: string, resource: string): Promise<T> {
    return JSON.parse(
      await this.runner("kubectl", [
        "--context",
        "kind-job-isolation",
        "-n",
        namespace,
        "get",
        resource,
        "-o",
        "json",
      ]),
    ) as T;
  }
  async exec(namespace: string, pod: string, args: string[]): Promise<string> {
    return this.runner("kubectl", [
      "--context",
      "kind-job-isolation",
      "-n",
      namespace,
      "exec",
      pod,
      "--",
      ...args,
    ]);
  }
  async logs(namespace: string, pod: string): Promise<string> {
    return this.runner("kubectl", [
      "--context",
      "kind-job-isolation",
      "-n",
      namespace,
      "logs",
      pod,
    ]);
  }
  // Inspect the node runtime after probes; deleted API objects alone do not prove termination.
  async runningWorkers(): Promise<{
    containers: { id: string; metadata: { name: string } }[];
  }> {
    return JSON.parse(
      await this.runner("docker", [
        "exec",
        "job-isolation-control-plane",
        "crictl",
        "ps",
        "--state",
        "Running",
        "--name",
        "worker",
        "-o",
        "json",
      ]),
    ) as { containers: { id: string; metadata: { name: string } }[] };
  }
  async workers(namespace: string): Promise<JobEvidence[]> {
    const [jobs, pods] = await Promise.all([
      this.get<List<V1Job>>(namespace, "jobs"),
      this.get<List<V1Pod>>(namespace, "pods"),
    ]);
    return jobs.items.map((job) => summarize(job, pods.items));
  }
  async server(namespace: string): Promise<V1Pod> {
    const { items } = await this.get<List<V1Pod>>(namespace, "pods");
    const pod = items.find(
      (item) =>
        item.metadata?.labels?.["app.kubernetes.io/component"] === "server" &&
        item.status?.phase === "Running",
    );
    if (!pod?.metadata?.name) throw new Error("Server pod missing.");
    return pod;
  }
  async node<T>(namespace: string, script: string): Promise<T> {
    const pod = await this.server(namespace);
    return JSON.parse(
      await this.exec(namespace, pod.metadata?.name ?? "", [
        "node",
        "-e",
        script,
      ]),
    ) as T;
  }
}
// Keep live controls in evidence while excluding the command-bearing execution configuration.
function fixedSpec(spec: V1PodSpec | undefined) {
  if (!spec) return undefined;
  return {
    ...spec,
    containers: spec.containers.map(({ env, ...container }) => ({
      ...container,
      ...(env
        ? { env: env.filter((item) => item.name !== "EXECUTION_CONFIG") }
        : {}),
    })),
  };
}
// Join Jobs to Pods by the server-selected execution label and retain immutable identities.
export function summarize(job: V1Job, pods: V1Pod[]) {
  const id = job.metadata?.labels?.["execution-id"];
  return {
    id,
    uid: job.metadata?.uid,
    name: job.metadata?.name,
    labels: job.metadata?.labels,
    status: job.status,
    backoffLimit: job.spec?.backoffLimit,
    activeDeadlineSeconds: job.spec?.activeDeadlineSeconds,
    ttlSecondsAfterFinished: job.spec?.ttlSecondsAfterFinished,
    spec: fixedSpec(job.spec?.template.spec),
    pods: pods
      .filter((pod) => id && pod.metadata?.labels?.["execution-id"] === id)
      .map((pod) => ({
        uid: pod.metadata?.uid,
        name: pod.metadata?.name,
        labels: pod.metadata?.labels,
        phase: pod.status?.phase,
        spec: fixedSpec(pod.spec),
        statuses: pod.status?.containerStatuses,
      })),
  };
}
