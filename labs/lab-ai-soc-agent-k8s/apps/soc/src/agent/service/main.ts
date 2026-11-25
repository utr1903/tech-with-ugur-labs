import { serve } from "@hono/node-server";
import {
  AppsV1Api,
  BatchV1Api,
  CoreV1Api,
  KubeConfig,
  NetworkingV1Api,
  RbacAuthorizationV1Api,
} from "@kubernetes/client-node";
import type { Logger } from "../../logger.js";
import { createAnthropicRunnerFactory } from "../loop/client.js";
import { runInvestigation } from "../loop/investigate.js";
import {
  createK8sReader,
  createSecretMetadataClient,
} from "../tools/k8s-reader.js";
import { createLokiClient } from "../tools/loki-client.js";
import { type AgentConfig, loadConfig } from "./config.js";
import { createDeduper } from "./dedupe.js";
import { createQueue } from "./queue.js";
import { createReportStore } from "./reports.js";
import { createResponderClient } from "./responder-client.js";
import { createApp } from "./routes.js";

const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

function loadReader() {
  const kc = new KubeConfig();
  kc.loadFromCluster();
  return createK8sReader({
    core: kc.makeApiClient(CoreV1Api),
    apps: kc.makeApiClient(AppsV1Api),
    batch: kc.makeApiClient(BatchV1Api),
    networking: kc.makeApiClient(NetworkingV1Api),
    rbac: kc.makeApiClient(RbacAuthorizationV1Api),
  });
}

function buildRun(cfg: AgentConfig, logger: Logger) {
  const base = {
    loki: createLokiClient(cfg.lokiUrl),
    k8s: loadReader(),
    secrets: createSecretMetadataClient(cfg.responderUrl, cfg.responderToken),
    logger,
    now: () => new Date(),
    createRunner: createAnthropicRunnerFactory(),
    tokenBudget: cfg.tokenBudget,
    maxIterations: cfg.maxIterations,
  };
  return (input: Parameters<typeof runInvestigation>[0]) =>
    runInvestigation(input, { ...base, alerts: input.alerts });
}

export function startAgent(logger: Logger): void {
  const cfg = loadConfig(process.env);
  logger.info(
    { port: cfg.port, reportsDir: cfg.reportsDir },
    "Starting agent...",
  );
  const app = createApp({
    logger,
    agentToken: cfg.agentToken,
    queue: createQueue(),
    store: createReportStore(cfg.reportsDir),
    deduper: createDeduper(DEDUPE_WINDOW_MS, () => Date.now()),
    now: () => new Date(),
    run: buildRun(cfg, logger),
    responder: createResponderClient(cfg.responderUrl, cfg.responderToken),
  });
  const server = serve({ fetch: app.fetch, port: cfg.port });
  process.on("SIGTERM", () => server.close());
  logger.info({ port: cfg.port }, "Starting agent succeeded.");
}
