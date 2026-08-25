import type { Ctx } from "../context.js";
import { sleep } from "../lib/poll.js";
import { singleValue } from "../prom/compare.js";

// Not exported: nothing outside this file needs the shape (knip flags an
// exported-but-unused type otherwise).
type OutagePoll = { ok: boolean; complete: boolean };

const NODE_COUNT = 3;
const OUTAGE_WINDOW_SECONDS = 90;
const DOWN_WAIT_SECONDS = 60;

// Errors during the outage are tolerated (DNS SD needs a few seconds to drop
// a dead store); what is never tolerated is a *successful* answer with data
// missing — that would be Thanos lying about completeness.
export function assertOutagePolls(polls: OutagePoll[]): void {
  const successes = polls.filter((p) => p.ok);
  if (successes.length === 0) {
    throw new Error(
      `no successful Thanos query during the outage window (${polls.length} polls)`,
    );
  }
  const incomplete = successes.filter((p) => !p.complete);
  if (incomplete.length > 0) {
    throw new Error(
      `${incomplete.length} successful poll(s) returned incomplete data during the outage`,
    );
  }
}

async function pollOnce(ctx: Ctx): Promise<OutagePoll> {
  try {
    const instant = singleValue(
      await ctx.thanos.instantQuery('count(up{job="node-exporter"} == 1)', {
        dedup: true,
        partialResponse: false,
      }),
    );
    const nowSec = Math.floor(Date.now() / 1000);
    const range = await ctx.thanos.rangeQuery(
      'sum(up{job="node-exporter"})',
      nowSec - 60,
      nowSec,
      15,
      { dedup: true, partialResponse: false },
    );
    const points = range[0]?.values ?? [];
    const gapless =
      points.length >= 4 &&
      points.every(([, v]) => Number.parseFloat(v) === NODE_COUNT);
    return { ok: true, complete: instant === NODE_COUNT && gapless };
  } catch {
    return { ok: false, complete: false };
  }
}

// kubectl delete --wait=false returns before the kill takes effect: the
// killed pod can still report Ready=True for a brief moment while it
// terminates. Wait for the outage to actually start before watching for
// restoration, or the poll loop below can exit on its very first check
// and record zero polls even though nothing was actually proven.
export async function waitUntilDown(
  isStillUp: () => Promise<boolean>,
  timeoutSeconds = DOWN_WAIT_SECONDS,
  intervalSeconds = 1,
): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline && (await isStillUp())) {
    await sleep(intervalSeconds);
  }
}

async function runOutage(
  ctx: Ctx,
  untilRestored: () => Promise<boolean>,
): Promise<OutagePoll[]> {
  await waitUntilDown(untilRestored);
  const polls: OutagePoll[] = [];
  const deadline = Date.now() + OUTAGE_WINDOW_SECONDS * 1000;
  while (Date.now() < deadline && !(await untilRestored())) {
    polls.push(await pollOnce(ctx));
    await sleep(2);
  }
  return polls;
}

async function killPrometheusReplica(ctx: Ctx): Promise<void> {
  const logger = ctx.logger.child({ stage: "kill-prometheus-replica" });
  const { thanosNamespace, promKillPod } = ctx.cfg;
  logger.info({ pod: promKillPod }, "Killing one Prometheus replica...");
  await ctx.kube.deletePod(thanosNamespace, promKillPod);
  const polls = await runOutage(ctx, () =>
    ctx.kube.isPodReady(thanosNamespace, promKillPod),
  );
  logger.info(
    { polls: polls.length, successes: polls.filter((p) => p.ok).length },
    "Outage window over.",
  );
  assertOutagePolls(polls);
  await ctx.kube.waitPodReady(thanosNamespace, promKillPod, 300);
  logger.info("Killing one Prometheus replica proved gapless.");
}

async function killQuerier(ctx: Ctx): Promise<void> {
  const logger = ctx.logger.child({ stage: "kill-querier" });
  const ns = ctx.cfg.thanosNamespace;
  const pods = await ctx.kube.podNamesByLabel(
    ns,
    "app.kubernetes.io/name=thanos-query",
  );
  if (pods.length !== 2)
    throw new Error(`expected 2 thanos-query pods, found ${pods.length}`);
  const victim = pods[0];
  logger.info({ pod: victim }, "Killing one Thanos Query replica...");
  await ctx.kube.deletePod(ns, victim);
  const polls = await runOutage(ctx, () => ctx.kube.isPodReady(ns, victim));
  logger.info(
    { polls: polls.length, successes: polls.filter((p) => p.ok).length },
    "Outage window over.",
  );
  assertOutagePolls(polls);
  await ctx.kube.waitDeploymentReady(ns, "thanos-query", 300);
  logger.info("Killing one Thanos Query replica proved gapless.");
}

// Proof 4: HA means a dead Prometheus replica and a dead querier are both
// non-events for whoever is asking questions.
export async function runFailover(ctx: Ctx): Promise<void> {
  const logger = ctx.logger.child({ command: "failover" });
  try {
    logger.info("Checking failover behavior...");
    await killPrometheusReplica(ctx);
    await killQuerier(ctx);
    logger.info("Checking failover behavior succeeded.");
  } catch (err) {
    logger.error({ err }, "Checking failover behavior failed.");
    throw err;
  }
}
