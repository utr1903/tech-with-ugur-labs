import type { Runner } from "./process.js";
import { versions } from "./settings.js";
export async function prerequisites(run: Runner): Promise<void> {
  if (process.versions.node.split(".")[0] !== "22")
    throw new Error("Node 22 required.");
  const kind = await run("kind", ["version"]);
  const helm = await run("helm", ["version", "--short"]);
  if (
    !kind.startsWith(`kind v${versions.kindVersion} `) ||
    !helm.startsWith(`v${versions.helmVersion}+`)
  )
    throw new Error("Install the pinned kind and Helm versions.");
  const kubectl: { clientVersion: { gitVersion: string } } = JSON.parse(
    await run("kubectl", [
      "--context",
      "kind-job-isolation",
      "version",
      "--client",
      "-o",
      "json",
    ]),
  );
  if (kubectl.clientVersion.gitVersion !== `v${versions.kubectlVersion}`)
    throw new Error("Install the pinned kubectl version.");
  const docker = await run("docker", [
    "info",
    "--format",
    "{{.OSType}}/{{.Architecture}}",
  ]);
  if (!docker.trim().startsWith("linux/"))
    throw new Error("A running Linux Docker daemon is required.");
}
