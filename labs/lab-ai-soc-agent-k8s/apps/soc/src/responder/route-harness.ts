import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../logger.js";
import type { ActionProposal } from "../shared/actions.js";
import { createApprovalStore } from "./approvals.js";
import { createAuditTrail } from "./audit-trail.js";
import { createFakeCluster } from "./fake-apis.js";
import { DEFAULT_POLICY, type PolicyConfig } from "./policy.js";
import { createApp } from "./routes.js";
import { createSecretReader } from "./secret-metadata.js";

export const R = "Bearer responder-token";
export const A = "Bearer admin-token";

export type Harness = Awaited<ReturnType<typeof setup>>;

export async function setup(policy: PolicyConfig = DEFAULT_POLICY) {
  const dir = await mkdtemp(join(tmpdir(), "soc-routes-"));
  const executed: ActionProposal[] = [];
  let failNext = false;
  const approvals = createApprovalStore(join(dir, "approvals.json"));
  const audit = createAuditTrail(join(dir, "audit.jsonl"));
  const cluster = createFakeCluster();
  const app = createApp({
    logger: createLogger({ appName: "routes-test" }),
    policy,
    executor: {
      execute: async (p) => {
        if (failNext) throw new Error("api exploded");
        executed.push(p);
      },
    },
    approvals,
    audit,
    secrets: createSecretReader(cluster.apis.core),
    responderToken: "responder-token",
    adminToken: "admin-token",
  });
  const post = (path: string, auth: string | undefined, body?: unknown) =>
    app.request(path, {
      method: "POST",
      headers: {
        ...(auth ? { authorization: auth } : {}),
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const get = (path: string, auth?: string) =>
    app.request(path, { headers: auth ? { authorization: auth } : {} });
  return {
    app,
    post,
    get,
    executed,
    approvals,
    audit,
    cluster,
    failNext: () => {
      failNext = true;
    },
  };
}
