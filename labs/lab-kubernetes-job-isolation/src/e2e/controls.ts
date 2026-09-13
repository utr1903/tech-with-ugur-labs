import {
  benign,
  type Context,
  checkAttempt,
  type Mode,
  record,
  request,
} from "./context.js";
import { clusterControls } from "./live-controls.js";
export function runtimeRestricted(output: string): boolean {
  return (
    output.includes("uid=10001\n") &&
    output.includes("home-owner=10001:10001\n") &&
    output.includes("Read-only file system") &&
    /NoNewPrivs:\s+1/.test(output) &&
    ["Inh", "Prm", "Eff", "Bnd", "Amb"].every((name) =>
      new RegExp(`Cap${name}:\\s+0+(?:\\n|$)`).test(output),
    )
  );
}
export async function controlChecks(ctx: Context) {
  await imageChecks(ctx);
  for (const mode of ["insecure", "secure"] as const) {
    await tokenCheck(ctx, mode);
    await runtimeCheck(ctx, mode);
  }
  await clusterControls(ctx);
}
async function imageChecks(ctx: Context) {
  const insecure = await benign(ctx, "insecure", "baseline real execution");
  const secure = await benign(ctx, "secure", "baseline real execution");
  const insecureImage = insecure.jobs[0]?.pods[0]?.statuses?.[0];
  const secureImage = secure.jobs[0]?.pods[0]?.statuses?.[0];
  const servers = await Promise.all([
    ctx.cluster.server("insecure"),
    ctx.cluster.server("secure"),
  ]);
  record(ctx, {
    operation: "operator identical live images",
    mode: "operator",
    expected: "both releases use the same worker and server bytes",
    observed: { output: `${insecureImage?.imageID} ${secureImage?.imageID}` },
    evidence: {
      workers: [insecureImage, secureImage],
      servers: servers.map((pod) => ({
        uid: pod.metadata?.uid,
        image: pod.spec?.containers[0]?.image,
        imageID: pod.status?.containerStatuses?.[0]?.imageID,
      })),
    },
    passed:
      Boolean(insecureImage?.imageID) &&
      insecureImage?.imageID === secureImage?.imageID &&
      insecureImage?.image === secureImage?.image &&
      Boolean(servers[0]?.status?.containerStatuses?.[0]?.imageID) &&
      servers[0]?.status?.containerStatuses?.[0]?.imageID ===
        servers[1]?.status?.containerStatuses?.[0]?.imageID &&
      servers[0]?.spec?.containers[0]?.image ===
        servers[1]?.spec?.containers[0]?.image,
  });
}
async function tokenCheck(ctx: Context, mode: Mode) {
  const token = await request(
    ctx,
    mode,
    mode === "insecure"
      ? 'token=/var/run/secrets/kubernetes.io/serviceaccount/token; test -s "$token" && wc -c < "$token"'
      : `node -e "const fs=require('node:fs');try{fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token');process.stdout.write('token-present-no-bytes\\n');process.exit(3);}catch{process.stdout.write('token-absent\\n');process.exit(1);}"`,
  );
  const tokenPassed =
    token.response.status === 200 &&
    (mode === "insecure"
      ? token.response.body.exitCode === 0 &&
        /^\s*[1-9]\d*\s*$/.test(token.response.body.output ?? "")
      : token.response.body.exitCode === 1 &&
        token.response.body.output === "token-absent\n" &&
        token.jobs[0]?.spec?.automountServiceAccountToken === false);
  checkAttempt(
    ctx,
    mode,
    "service-account token availability",
    mode === "insecure"
      ? "nonempty token count only; no JWT bytes"
      : "token read fails and no token bytes returned",
    token,
    tokenPassed,
    {
      denial: mode === "secure",
      positiveControl: ctx.checks.some(
        (check) =>
          check.operation === "service-account token availability" &&
          check.mode === "insecure" &&
          check.passed,
      ),
      operatorConfirmed:
        mode === "insecure" ||
        token.jobs[0]?.spec?.automountServiceAccountToken === false,
    },
  );
}
async function runtimeCheck(ctx: Context, mode: Mode) {
  const command =
    mode === "insecure"
      ? 'printf "uid="; id -u; printf "home-owner="; stat -c "%u:%g" "$HOME"; touch "$HOME/rootfs-probe" && rm "$HOME/rootfs-probe"'
      : 'printf "uid="; id -u; printf "home-owner="; stat -c "%u:%g" "$HOME"; grep -E "^(Cap(Inh|Prm|Eff|Bnd|Amb)|NoNewPrivs):" /proc/self/status; touch "$HOME/rootfs-probe"';
  const runtime = await request(ctx, mode, command);
  const spec = runtime.jobs[0]?.pods[0]?.spec;
  const security = spec?.containers[0]?.securityContext;
  const restricted =
    spec?.securityContext?.runAsUser === 10001 &&
    spec.securityContext.runAsNonRoot === true &&
    spec.securityContext.seccompProfile?.type === "RuntimeDefault" &&
    security?.readOnlyRootFilesystem === true &&
    security.allowPrivilegeEscalation === false &&
    security.capabilities?.drop?.includes("ALL") &&
    spec.volumes?.some((volume) => volume.emptyDir?.sizeLimit === "64Mi");
  checkAttempt(
    ctx,
    mode,
    "identity capabilities nnp and rootfs",
    mode === "insecure"
      ? "root can write runner-owned HOME on the image rootfs"
      : "UID 10001, zero capabilities, nnp=1, runner-owned HOME write returns EROFS",
    runtime,
    runtime.response.status === 200 &&
      (mode === "insecure"
        ? runtime.response.body.exitCode === 0 &&
          (runtime.response.body.output ?? "").includes("uid=0\n") &&
          (runtime.response.body.output ?? "").includes(
            "home-owner=10001:10001\n",
          )
        : runtime.response.body.exitCode !== 0 &&
          runtimeRestricted(runtime.response.body.output ?? "") &&
          Boolean(restricted)),
    {
      denial: mode === "secure",
      positiveControl: ctx.checks.some(
        (check) =>
          check.operation === "identity capabilities nnp and rootfs" &&
          check.mode === "insecure" &&
          check.passed,
      ),
      operatorConfirmed: mode === "insecure" || Boolean(restricted),
      rootfsPath: "/home/runner/rootfs-probe",
      livePodSpec: spec,
    },
  );
}
