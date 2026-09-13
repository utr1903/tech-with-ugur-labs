import type { Runner } from "./process.js";
import { cluster, versions } from "./settings.js";
export async function existingCluster(run: Runner): Promise<boolean> {
  const clusters = (await run("kind", ["get", "clusters"])).trim().split("\n");
  if (!clusters.includes(cluster)) return false;
  const nodes = (await run("kind", ["get", "nodes", "--name", cluster]))
    .trim()
    .split("\n");
  const inspection: {
    Config: { Image: string; Labels: Record<string, string> };
  }[] = JSON.parse(await run("docker", ["inspect", ...nodes]));
  if (
    nodes.length !== 1 ||
    nodes[0] !== `${cluster}-control-plane` ||
    inspection.length !== 1 ||
    inspection[0]?.Config.Image !== versions.kindNodeImage ||
    inspection[0]?.Config.Labels["io.x-k8s.kind.cluster"] !== cluster
  ) {
    throw new Error(
      "Existing cluster is not the pinned lab cluster. Run teardown only after checking ownership.",
    );
  }
  return true;
}
