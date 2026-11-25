import { join } from "node:path";
import { serve } from "@hono/node-server";
import {
  AppsV1Api,
  CoreV1Api,
  KubeConfig,
  NetworkingV1Api,
  RbacAuthorizationV1Api,
} from "@kubernetes/client-node";
import type { Logger } from "../logger.js";
import { createApprovalStore } from "./approvals.js";
import { createAuditTrail } from "./audit-trail.js";
import { createExecutor, type K8sApis } from "./executor.js";
import { DEFAULT_POLICY } from "./policy.js";
import { createApp } from "./routes.js";
import { createSecretReader } from "./secret-metadata.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function loadApis(): K8sApis {
  const kc = new KubeConfig();
  kc.loadFromCluster();
  return {
    core: kc.makeApiClient(CoreV1Api),
    apps: kc.makeApiClient(AppsV1Api),
    networking: kc.makeApiClient(NetworkingV1Api),
    rbac: kc.makeApiClient(RbacAuthorizationV1Api),
  };
}

export function startResponder(logger: Logger): void {
  const port = Number(process.env.PORT ?? 8081);
  const stateDir = process.env.STATE_DIR ?? "/var/lib/soc";
  logger.info({ port, stateDir }, "Starting responder...");
  const apis = loadApis();
  const app = createApp({
    logger,
    policy: DEFAULT_POLICY,
    executor: createExecutor(apis, logger),
    approvals: createApprovalStore(join(stateDir, "approvals.json")),
    audit: createAuditTrail(join(stateDir, "audit.jsonl")),
    secrets: createSecretReader(apis.core),
    responderToken: requireEnv("RESPONDER_TOKEN"),
    adminToken: requireEnv("ADMIN_TOKEN"),
  });
  const server = serve({ fetch: app.fetch, port });
  process.on("SIGTERM", () => server.close());
  logger.info({ port }, "Starting responder succeeded.");
}
