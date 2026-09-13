import type { V1Pod, V1Service } from "@kubernetes/client-node";
import type { List } from "./cluster.js";
import { type Context, checkAttempt, record, request } from "./context.js";
import type { Response } from "./http.js";
import { forbiddenFeatures } from "./live-controls.js";
import { routeCheck } from "./network-download.js";
export function dnsObservation(
  mode: "insecure" | "secure",
  actual: Response,
  serviceIP: string,
): boolean {
  if (actual.status !== 200) return false;
  if (mode === "insecure")
    return (
      actual.body.exitCode === 0 &&
      (actual.body.output ?? "").includes(serviceIP)
    );
  return [124, 2].includes(actual.body.exitCode ?? -1);
}

const host = "download-fixture.download-fixture.svc.cluster.local";
export async function networkChecks(ctx: Context) {
  const [pods, service] = await Promise.all([
    ctx.cluster.get<List<V1Pod>>("download-fixture", "pods"),
    ctx.cluster.get<V1Service>("download-fixture", "service/download-fixture"),
  ]);
  const fixture = pods.items.find(
    (pod) =>
      pod.status?.phase === "Running" &&
      pod.status.containerStatuses?.every((status) => status.ready),
  );
  const pod = fixture?.metadata?.name;
  const podIP = fixture?.status?.podIP;
  const serviceIP = service.spec?.clusterIP;
  if (!pod || !podIP || !serviceIP)
    throw new Error("Ready fixture addressing missing.");
  record(ctx, {
    operation: "operator fixture addressing",
    mode: "operator",
    expected: "ready local fixture with Pod and Service IPs",
    observed: { output: `${podIP} ${serviceIP}` },
    evidence: {
      podUid: fixture.metadata?.uid,
      podIP,
      serviceIP,
      fixturePodSpec: fixture.spec,
      ready: fixture.status?.containerStatuses?.map((status) => status.ready),
    },
    passed: Boolean(fixture.metadata?.uid) && !forbiddenFeatures(fixture.spec),
  });
  for (const [route, target] of [
    ["DNS", host],
    ["ServiceIP", serviceIP],
    ["PodIP", podIP],
  ] as const) {
    await routeCheck(ctx, pod, fixture, route, target);
  }
  for (const mode of ["insecure", "secure"] as const) {
    const dns = await request(
      ctx,
      mode,
      `timeout 4 getent hosts '${host}'; code=$?; printf 'dns-exit=%s\\n' "$code"; exit "$code"`,
    );
    checkAttempt(
      ctx,
      mode,
      "independent bounded DNS resolution",
      mode === "insecure"
        ? "DNS resolves local fixture"
        : "DNS denied within four seconds",
      dns,
      dnsObservation(mode, dns.response, serviceIP),
      {
        denial: mode === "secure",
        positiveControl: ctx.checks.some(
          (check) =>
            check.operation === "independent bounded DNS resolution" &&
            check.mode === "insecure" &&
            check.passed,
        ),
        operatorConfirmed: Boolean(fixture.metadata?.uid),
        hostname: host,
        timeoutSeconds: 4,
      },
    );
  }
}
