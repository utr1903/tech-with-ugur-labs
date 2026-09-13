import { existingCluster } from "./cluster.js";
import type { Runner } from "./process.js";
import { cluster, context, images, versions } from "./settings.js";

async function cni(run: Runner): Promise<void> {
  await run("helm", ["repo", "add", "cilium", "https://helm.cilium.io/"]);
  await run("helm", ["repo", "update", "cilium"]);
  await run("helm", [
    "upgrade",
    "--install",
    "cilium",
    versions.cniChart,
    "--version",
    versions.cniChartVersion,
    "--namespace",
    "kube-system",
    "--kube-context",
    context,
    "--set",
    "image.pullPolicy=IfNotPresent",
    "--set",
    "ipam.mode=kubernetes",
    "--set",
    "operator.replicas=1",
    "--wait",
    "--timeout",
    "10m",
  ]);
  for (const resource of [
    "daemonset/cilium",
    "daemonset/cilium-envoy",
    "deployment/cilium-operator",
  ]) {
    await run("kubectl", [
      "--context",
      context,
      "-n",
      "kube-system",
      "rollout",
      "status",
      resource,
      "--timeout=10m",
    ]);
  }
  await run("kubectl", [
    "--context",
    context,
    "wait",
    "--for=condition=Ready",
    "nodes",
    "--all",
    "--timeout=10m",
  ]);
}
async function ensureNamespace(run: Runner, namespace: string): Promise<void> {
  // Do not take over a pre-existing namespace belonging to another application.
  const data = await run("kubectl", [
    "--context",
    context,
    "get",
    "namespace",
    namespace,
    "--ignore-not-found",
    "-o",
    "json",
  ]);
  if (data.trim()) {
    const existing: { metadata: { labels?: Record<string, string> } } =
      JSON.parse(data);
    if (existing.metadata.labels?.["app.kubernetes.io/part-of"] !== cluster)
      throw new Error("Namespace already exists outside this lab.");
  } else {
    await run("kubectl", [
      "--context",
      context,
      "create",
      "namespace",
      namespace,
    ]);
    await run("kubectl", [
      "--context",
      context,
      "label",
      "namespace",
      namespace,
      `app.kubernetes.io/part-of=${cluster}`,
    ]);
  }
}
async function release(
  run: Runner,
  namespaceName: string,
  secure: boolean,
): Promise<void> {
  await ensureNamespace(run, namespaceName);
  const namespace = namespaceName;
  await run("helm", [
    "upgrade",
    "--install",
    namespace,
    "deploy/chart",
    "--namespace",
    namespace,
    "--kube-context",
    context,
    "--set",
    `secure=${secure}`,
    "--wait",
    "--timeout",
    "5m",
  ]);
  await run("kubectl", [
    "--context",
    context,
    "-n",
    namespace,
    "rollout",
    "restart",
    "deployment/server",
  ]);
  await run("kubectl", [
    "--context",
    context,
    "-n",
    namespace,
    "rollout",
    "status",
    "deployment/server",
    "--timeout=5m",
  ]);
  await run("kubectl", [
    "--context",
    context,
    "-n",
    namespace,
    "wait",
    "--for=jsonpath={.status.phase}=Bound",
    "pvc/execution-data",
    "--timeout=5m",
  ]);
}
export async function deploy(run: Runner): Promise<void> {
  if (!(await existingCluster(run)))
    await run("kind", [
      "create",
      "cluster",
      "--name",
      cluster,
      "--image",
      versions.kindNodeImage,
      "--config",
      "deploy/kind.yaml",
    ]);
  await cni(run);
  const dockerfiles = ["Dockerfile", "worker/Dockerfile", "fixture/Dockerfile"];
  for (const [index, image] of images.entries())
    await run("docker", [
      "build",
      "-f",
      dockerfiles[index] ?? "Dockerfile",
      "-t",
      image,
      ".",
    ]);
  await run("kind", ["load", "docker-image", ...images, "--name", cluster]);
  await release(run, "insecure", false);
  await release(run, "secure", true);
  await ensureNamespace(run, "download-fixture");
  await run("kubectl", [
    "--context",
    context,
    "apply",
    "-f",
    "deploy/fixture.yaml",
  ]);
  await run("kubectl", [
    "--context",
    context,
    "-n",
    "download-fixture",
    "rollout",
    "restart",
    "deployment/download-fixture",
  ]);
  await run("kubectl", [
    "--context",
    context,
    "-n",
    "download-fixture",
    "rollout",
    "status",
    "deployment/download-fixture",
    "--timeout=5m",
  ]);
}
