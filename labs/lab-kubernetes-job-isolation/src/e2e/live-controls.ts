import type {
  V1DaemonSet,
  V1NetworkPolicy,
  V1Node,
  V1PodSpec,
} from "@kubernetes/client-node";
import type { JobEvidence, List } from "./cluster.js";
import { type Context, record } from "./context.js";
export function workerBound(job: JobEvidence): boolean {
  const resources = job.spec?.containers[0]?.resources;
  const bounded = ["cpu", "memory", "ephemeral-storage"].every(
    (name) => resources?.requests?.[name] && resources.limits?.[name],
  );
  return Boolean(
    job.uid &&
      job.backoffLimit === 0 &&
      job.activeDeadlineSeconds === 30 &&
      job.ttlSecondsAfterFinished === 3600 &&
      job.spec?.restartPolicy === "Never" &&
      bounded &&
      !forbiddenFeatures(job.spec) &&
      job.pods.length === 1 &&
      job.pods.every(
        (pod) =>
          pod.uid &&
          pod.labels?.["app.kubernetes.io/component"] === "worker" &&
          !forbiddenFeatures(pod.spec) &&
          pod.statuses?.length === 1 &&
          pod.statuses.every((status) => status.restartCount === 0),
      ),
  );
}
export async function observedWorkerChecks(ctx: Context) {
  const jobs = new Map<string, JobEvidence>();
  for (const check of ctx.checks) {
    if (!Array.isArray(check.evidence.jobs)) continue;
    for (const job of check.evidence.jobs as JobEvidence[])
      if (job.uid) jobs.set(job.uid, job);
  }
  const observed = [...jobs.values()];
  record(ctx, {
    operation: "operator all observed worker templates",
    mode: "operator",
    expected:
      "every observed real worker has selector labels, resource bounds, no retries or forbidden features",
    observed: { output: `observed-jobs=${observed.length}` },
    evidence: {
      observedJobUids: observed.map((job) => job.uid),
      invalidJobUids: observed
        .filter((job) => !workerBound(job))
        .map((job) => job.uid),
    },
    passed: observed.length > 0 && observed.every(workerBound),
  });
  const runtime = await ctx.cluster.runningWorkers();
  record(ctx, {
    operation: "operator worker runtime cleanup",
    mode: "operator",
    expected:
      "container runtime has no surviving running worker containers after all probes",
    observed: { output: `running-workers=${runtime.containers.length}` },
    evidence: {
      runtimeWorkerContainerIds: runtime.containers.map(
        (container) => container.id,
      ),
      runtimeCommand: "crictl ps --state Running --name worker",
      node: "job-isolation-control-plane",
      processGroupLimitation:
        "escaped process groups depend on container runtime cleanup",
    },
    passed: runtime.containers.length === 0,
  });
}
export function forbiddenFeatures(spec: V1PodSpec | undefined): boolean {
  if (!spec) return true;
  return Boolean(
    spec.hostNetwork ||
      spec.hostPID ||
      spec.hostIPC ||
      spec.volumes?.some((volume) => volume.hostPath) ||
      [...spec.containers, ...(spec.initContainers ?? [])].some(
        (container) =>
          container.securityContext?.privileged ||
          container.volumeMounts?.some((mount) =>
            /(?:docker|containerd)\.sock/.test(mount.mountPath),
          ),
      ),
  );
}
export async function clusterControls(ctx: Context) {
  const [cilium, nodes, policies] = await Promise.all([
    ctx.cluster.get<V1DaemonSet>("kube-system", "daemonset/cilium"),
    ctx.cluster.get<List<V1Node>>("default", "nodes"),
    ctx.cluster.get<List<V1NetworkPolicy>>("secure", "networkpolicies"),
  ]);
  const policy = policies.items.find(
    (item) => item.metadata?.name === "deny-worker-network",
  );
  const deny =
    policy?.spec?.podSelector?.matchLabels?.["app.kubernetes.io/component"] ===
      "worker" &&
    ["Ingress", "Egress"].every((type) =>
      policy.spec?.policyTypes?.includes(type),
    ) &&
    !policy.spec?.ingress?.length &&
    !policy.spec?.egress?.length;
  const ready =
    (cilium.status?.desiredNumberScheduled ?? 0) > 0 &&
    cilium.status?.numberReady === cilium.status?.desiredNumberScheduled &&
    nodes.items.every((node) =>
      node.status?.conditions?.some(
        (condition) =>
          condition.type === "Ready" && condition.status === "True",
      ),
    );
  record(ctx, {
    operation: "operator CNI and live worker policy",
    mode: "operator",
    expected:
      "Cilium and nodes ready; secure workers selected by zero ingress/egress policy",
    observed: {
      output: `cilium-ready=${cilium.status?.numberReady};deny=${Boolean(deny)}`,
    },
    evidence: {
      cilium: {
        uid: cilium.metadata?.uid,
        status: cilium.status,
        images: cilium.spec?.template.spec?.containers.map(
          (container) => container.image,
        ),
      },
      nodes: nodes.items.map((node) => ({
        uid: node.metadata?.uid,
        conditions: node.status?.conditions,
      })),
      policy,
    },
    passed: ready && Boolean(deny),
  });
  for (const mode of ["insecure", "secure"] as const) {
    const server = await ctx.cluster.server(mode);
    const jobs = await ctx.cluster.workers(mode);
    const valid =
      jobs.length > 0 &&
      jobs.every(
        (job) =>
          job.backoffLimit === 0 &&
          job.activeDeadlineSeconds === 30 &&
          job.ttlSecondsAfterFinished === 3600 &&
          job.spec?.restartPolicy === "Never" &&
          !forbiddenFeatures(job.spec) &&
          job.pods.length === 1 &&
          job.pods.every(
            (pod) =>
              pod.labels?.["app.kubernetes.io/component"] === "worker" &&
              !forbiddenFeatures(pod.spec) &&
              pod.statuses?.every((status) => status.restartCount === 0),
          ),
      ) &&
      !forbiddenFeatures(server.spec) &&
      !server.spec?.securityContext?.fsGroup;
    record(ctx, {
      operation: "operator worker labels bounds and forbidden features",
      mode: "operator",
      expected: `${mode}: real workers carry policy labels; no retries or forbidden host features`,
      observed: { output: `jobs=${jobs.length}` },
      evidence: {
        jobs,
        server: { uid: server.metadata?.uid, spec: server.spec },
      },
      passed: valid,
    });
  }
}
