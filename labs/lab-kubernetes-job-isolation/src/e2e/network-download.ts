import type { V1Pod } from "@kubernetes/client-node";
import {
  type Context,
  checkAttempt,
  type Mode,
  ownId,
  request,
} from "./context.js";
export function blockedIp(evidence: {
  exitCode: number | undefined;
  before: number;
  after: number;
  positiveBefore: boolean;
  positiveAfter: boolean;
  markerExists: boolean;
}): boolean {
  return (
    evidence.exitCode === 28 &&
    evidence.before === evidence.after &&
    evidence.positiveBefore &&
    evidence.positiveAfter &&
    !evidence.markerExists
  );
}
const marker = "printf 'SIMULATED_DOWNLOAD_MARKER\\n'\n";
async function requestCount(ctx: Context, pod: string): Promise<number> {
  const logs = await ctx.cluster.logs("download-fixture", pod);
  return logs
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { path?: string })
    .filter((line) => line.path === "/marker.sh").length;
}
async function download(ctx: Context, mode: Mode, url: string) {
  const attempt = await request(
    ctx,
    mode,
    `${ownId}curl --connect-timeout 2 --max-time 3 -fsS '${url}' -o "$HOME/data/download-$id.sh"; code=$?; if test "$code" -eq 0; then cat "$HOME/data/download-$id.sh"; fi; exit "$code"`,
  );
  const id = attempt.response.body.id;
  if (!id) return { attempt, exists: true, bytes: "", path: "missing-id" };
  const path =
    mode === "insecure"
      ? `/data/download-${id}.sh`
      : `/data/runs/${id}/download-${id}.sh`;
  const file = await ctx.cluster.node<{ exists: boolean; bytes: string }>(
    mode,
    `const fs=require('node:fs'); const path=${JSON.stringify(path)}; process.stdout.write(JSON.stringify({exists:fs.existsSync(path),bytes:fs.existsSync(path)?fs.readFileSync(path,'utf8'):''}));`,
  );
  return { attempt, ...file, path };
}
export async function routeCheck(
  ctx: Context,
  pod: string,
  fixture: V1Pod,
  route: "DNS" | "ServiceIP" | "PodIP",
  target: string,
) {
  const url = `http://${target}:8080/marker.sh`;
  const initial = await requestCount(ctx, pod);
  const positive = await download(ctx, "insecure", url);
  const before = await requestCount(ctx, pod);
  const positiveBefore =
    positive.attempt.response.status === 200 &&
    positive.attempt.response.body.exitCode === 0 &&
    positive.attempt.response.body.output === marker &&
    positive.exists &&
    positive.bytes === marker &&
    before === initial + 1;
  checkAttempt(
    ctx,
    "insecure",
    `${route} download positive before`,
    "exact harmless downloaded bytes and one fixture hit",
    positive.attempt,
    positiveBefore,
    {
      url,
      operatorPath: positive.path,
      downloadedBytes: positive.bytes,
      fixtureCountBefore: initial,
      fixtureCountAfter: before,
      fixturePodUid: fixture.metadata?.uid,
    },
  );
  const denied = await download(ctx, "secure", url);
  const after = await requestCount(ctx, pod);
  const recovery = await download(ctx, "insecure", url);
  const final = await requestCount(ctx, pod);
  const positiveAfter =
    recovery.attempt.response.status === 200 &&
    recovery.attempt.response.body.exitCode === 0 &&
    recovery.attempt.response.body.output === marker &&
    recovery.exists &&
    recovery.bytes === marker &&
    final === after + 1;
  checkAttempt(
    ctx,
    "insecure",
    `${route} download positive after`,
    "fixture still reachable and exact bytes downloaded",
    recovery.attempt,
    positiveAfter,
    {
      operatorPath: recovery.path,
      downloadedBytes: recovery.bytes,
      fixtureCountBefore: after,
      fixtureCountAfter: final,
    },
  );
  const denial =
    route === "DNS"
      ? denied.attempt.response.body.exitCode !== 0 &&
        !denied.exists &&
        before === after &&
        positiveBefore &&
        positiveAfter
      : blockedIp({
          exitCode: denied.attempt.response.body.exitCode,
          before,
          after,
          positiveBefore,
          positiveAfter,
          markerExists: denied.exists,
        });
  checkAttempt(
    ctx,
    "secure",
    `${route} bounded download denial`,
    "HTTP 200/nonzero curl exit, no downloaded file, no fixture hit",
    denied.attempt,
    denied.attempt.response.status === 200 && denial,
    {
      denial: true,
      positiveControl: positiveBefore && positiveAfter,
      operatorConfirmed: Boolean(fixture.metadata?.uid) && !denied.exists,
      url,
      fixturePodUid: fixture.metadata?.uid,
      fixtureCountBefore: before,
      fixtureCountAfter: after,
      downloadedFileExists: denied.exists,
      operatorPath: denied.path,
      dnsIndependent: route !== "DNS",
    },
  );
}
