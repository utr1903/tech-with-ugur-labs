import type { ClientConfig } from "../config.js";
import { attemptDirectByName, type BypassOutcome } from "../egress/bypass.js";
import { type ProxyResponse, requestViaProxy } from "../egress/proxyClient.js";
import { startSchedule } from "../egress/scheduler.js";
import type { Tally } from "../egress/tally.js";
import {
  createTally,
  recordDenied,
  recordFailure,
  recordSuccess,
  totalSuccesses,
} from "../egress/tally.js";
import type { Logger } from "../logger.js";

// The two deliberate negatives fire early in the run so their outcome is on the
// dashboard and in the logs long before the workload finishes.
const DENIED_ATTEMPT_AT_MS = 5000;
const BYPASS_ATTEMPT_AT_MS = 8000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runEgressWorkload(
  cfg: ClientConfig,
  logger: Logger,
): Promise<void> {
  const tally = createTally();
  const inFlight = new Set<Promise<void>>();

  logger.info(
    {
      client: cfg.clientName,
      proxy: `${cfg.proxyHost}:${cfg.proxyPort}`,
      runSeconds: cfg.runSeconds,
    },
    "Running the egress workload...",
  );

  const stop = startSchedule(cfg.plan, (url) =>
    fetchThroughGateway({ cfg, logger, tally, inFlight, url }),
  );
  const denied = scheduleDeniedAttempt(cfg, logger, tally);
  const bypass = scheduleBypassAttempt(cfg, logger);

  await sleep(cfg.runSeconds * 1000);
  stop();
  await Promise.all([...inFlight, denied, bypass]);

  logger.info(
    {
      client: cfg.clientName,
      totalSuccesses: totalSuccesses(tally),
      successesByDestination: tally.successesByDestination,
      bytesByDestination: tally.bytesByDestination,
      deniedCount: tally.deniedCount,
      failureCount: tally.failureCount,
      denied: await denied,
      bypass: await bypass,
    },
    "Egress run summary.",
  );
}

// One scheduled request through the gateway, started and left to finish in the
// background. Only the failures are logged: the scheduled requests are the bulk
// of a run - one a second for its whole length - and an entry and a success line
// for each would bury everything else. The per-destination totals in the run
// summary are where the successful path is accounted for.
function fetchThroughGateway(args: {
  cfg: ClientConfig;
  logger: Logger;
  tally: Tally;
  inFlight: Set<Promise<void>>;
  url: string;
}): void {
  const { cfg, logger, tally, inFlight, url } = args;
  const task = (async () => {
    try {
      const result = await requestViaProxy({
        proxyHost: cfg.proxyHost,
        proxyPort: cfg.proxyPort,
        url,
        timeoutMs: cfg.requestTimeoutMs,
      });
      if (result.ok && result.status === 200) {
        recordSuccess(tally, url, result.bytes);
        return;
      }
      recordFailure(tally);
      logger.warn(
        { url, result },
        "Fetching an allow-listed destination failed.",
      );
    } catch (err) {
      recordFailure(tally);
      logger.warn({ err, url }, "Fetching an allow-listed destination failed.");
    }
  })();
  inFlight.add(task);
  // The task swallows its own failures, so neither it nor the promise that
  // `finally` derives from it can reject - which matters, because nothing awaits
  // that derived one.
  task.finally(() => inFlight.delete(task));
}

// A request through the gateway to a destination that is not on the allow-list.
// The gateway answers it itself; the request never reaches any upstream.
async function scheduleDeniedAttempt(
  cfg: ClientConfig,
  logger: Logger,
  tally: Tally,
): Promise<{
  url: string;
  status: number | null;
  bodyPreview: string | null;
  error?: string;
}> {
  await sleep(DENIED_ATTEMPT_AT_MS);
  logger.info(
    { url: cfg.deniedUrl },
    "Requesting a destination that is not on the allow-list...",
  );
  const result: ProxyResponse = await requestViaProxy({
    proxyHost: cfg.proxyHost,
    proxyPort: cfg.proxyPort,
    url: cfg.deniedUrl,
    timeoutMs: cfg.requestTimeoutMs,
  });
  if (!result.ok) {
    logger.warn(
      { url: cfg.deniedUrl, error: result.error },
      "Requesting a destination that is not on the allow-list failed.",
    );
    return {
      url: cfg.deniedUrl,
      status: null,
      bodyPreview: null,
      error: result.error,
    };
  }
  recordDenied(tally);
  logger.info(
    {
      url: cfg.deniedUrl,
      status: result.status,
      bodyPreview: result.bodyPreview,
    },
    "Requesting a destination that is not on the allow-list succeeded (and was denied).",
  );
  return {
    url: cfg.deniedUrl,
    status: result.status,
    bodyPreview: result.bodyPreview,
  };
}

// An attempt to reach a destination directly, with no gateway in the path. The
// workload network has no route off itself, so this cannot succeed.
async function scheduleBypassAttempt(
  cfg: ClientConfig,
  logger: Logger,
): Promise<BypassOutcome & { host: string }> {
  await sleep(BYPASS_ATTEMPT_AT_MS);
  logger.info(
    { host: cfg.bypassHost, port: cfg.bypassPort },
    "Attempting to reach a destination without the gateway...",
  );
  const outcome = await attemptDirectByName({
    host: cfg.bypassHost,
    port: cfg.bypassPort,
    timeoutMs: cfg.requestTimeoutMs,
  });
  const fields = { host: cfg.bypassHost, ...outcome };
  if (outcome.blocked) {
    logger.info(
      fields,
      "Attempting to reach a destination without the gateway failed, as it must.",
    );
  } else {
    // The alarming case: the workload got out. It carries the alarm in its
    // level rather than in its wording.
    logger.error(
      fields,
      "Attempting to reach a destination without the gateway succeeded - the workload network has a route out that it must not have.",
    );
  }
  return fields;
}
