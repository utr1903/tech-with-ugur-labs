import {
  type AppsV1Api,
  type CoreV1Api,
  type NetworkingV1Api,
  PatchStrategy,
  type RbacAuthorizationV1Api,
  setHeaderOptions,
  type V1NetworkPolicy,
} from "@kubernetes/client-node";
import type { Logger } from "../logger.js";
import type { ActionProposal } from "../shared/actions.js";
import { isAlreadyExists, isNotFound } from "./k8s-errors.js";
import { rotateSecret } from "./rotate-secret.js";

/** Exactly the client-node calls the executor (and secret reader) use. */
export type K8sApis = {
  core: Pick<
    CoreV1Api,
    | "patchNamespacedPod"
    | "readNamespacedSecret"
    | "replaceNamespacedSecret"
    | "listNamespacedSecret"
  >;
  apps: Pick<
    AppsV1Api,
    "patchNamespacedDeploymentScale" | "patchNamespacedStatefulSetScale"
  >;
  networking: Pick<
    NetworkingV1Api,
    "readNamespacedNetworkPolicy" | "createNamespacedNetworkPolicy"
  >;
  rbac: Pick<
    RbacAuthorizationV1Api,
    "deleteNamespacedRoleBinding" | "deleteClusterRoleBinding"
  >;
};

export type Executor = { execute(p: ActionProposal): Promise<void> };

const QUARANTINE_POLICY = "soc-quarantine";
const QUARANTINE_LABEL = "soc.quarantine";

const MERGE_PATCH = setHeaderOptions("Content-Type", PatchStrategy.MergePatch);

const quarantinePolicy: V1NetworkPolicy = {
  metadata: { name: QUARANTINE_POLICY },
  spec: {
    podSelector: { matchLabels: { [QUARANTINE_LABEL]: "true" } },
    // Selected for both directions with no allow rules: deny everything.
    policyTypes: ["Ingress", "Egress"],
  },
};

async function ensureQuarantinePolicy(
  api: K8sApis["networking"],
  namespace: string,
): Promise<void> {
  try {
    await api.readNamespacedNetworkPolicy({
      name: QUARANTINE_POLICY,
      namespace,
    });
  } catch (err) {
    if (!isNotFound(err)) throw err;
    try {
      await api.createNamespacedNetworkPolicy({
        namespace,
        body: quarantinePolicy,
      });
    } catch (createErr) {
      if (!isAlreadyExists(createErr)) throw createErr;
    }
  }
}

/**
 * Isolate a pod: make sure the deny-all policy exists, then label the
 * pod so it is selected. The pod is deliberately never deleted: its
 * controller would respawn the same compromised image and the evidence
 * (process tree, files, memory) would be destroyed.
 */
async function quarantinePod(apis: K8sApis, p: ActionProposal): Promise<void> {
  const namespace = p.target.namespace ?? "";
  await ensureQuarantinePolicy(apis.networking, namespace);
  await apis.core.patchNamespacedPod(
    {
      name: p.target.name,
      namespace,
      body: { metadata: { labels: { [QUARANTINE_LABEL]: "true" } } },
    },
    MERGE_PATCH,
  );
}

async function scaleToZero(apis: K8sApis, p: ActionProposal): Promise<void> {
  const req = {
    name: p.target.name,
    namespace: p.target.namespace ?? "",
    body: { spec: { replicas: 0 } },
  };
  if (p.target.resource === "statefulset") {
    await apis.apps.patchNamespacedStatefulSetScale(req, MERGE_PATCH);
  } else {
    await apis.apps.patchNamespacedDeploymentScale(req, MERGE_PATCH);
  }
}

async function revokeBinding(apis: K8sApis, p: ActionProposal): Promise<void> {
  if (p.target.resource === "clusterrolebinding") {
    await apis.rbac.deleteClusterRoleBinding({ name: p.target.name });
  } else {
    await apis.rbac.deleteNamespacedRoleBinding({
      name: p.target.name,
      namespace: p.target.namespace ?? "",
    });
  }
}

function dispatch(apis: K8sApis, p: ActionProposal): Promise<void> {
  switch (p.kind) {
    case "quarantine_pod":
      return quarantinePod(apis, p);
    case "scale_to_zero":
      return scaleToZero(apis, p);
    case "revoke_binding":
      return revokeBinding(apis, p);
    case "rotate_secret":
      return rotateSecret(apis.core, p);
    default:
      return Promise.reject(
        new Error(`unsupported action kind ${String(p.kind)}`),
      );
  }
}

export function createExecutor(apis: K8sApis, logger: Logger): Executor {
  return {
    execute: async (p) => {
      const fields = { proposalId: p.id, kind: p.kind, target: p.target };
      try {
        logger.info(fields, "Executing action...");
        await dispatch(apis, p);
        logger.info(fields, "Executing action succeeded.");
      } catch (err) {
        logger.error({ err, ...fields }, "Executing action failed.");
        throw err;
      }
    },
  };
}
