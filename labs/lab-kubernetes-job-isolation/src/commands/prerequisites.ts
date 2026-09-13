import type { Runner } from "./process.js";
import { versions } from "./settings.js";
// Check the supported toolchain and Linux engine before any cluster mutation.
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
  // Query only the client version here; bootstrap may not have created the cluster yet.
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
  // Workers depend on Linux containers and process-group semantics, not a native host runtime.
  const docker = await run("docker", [
    "info",
    "--format",
    "{{.OSType}}/{{.Architecture}}",
  ]);
  if (!docker.trim().startsWith("linux/"))
    throw new Error("A running Linux Docker daemon is required.");
}
