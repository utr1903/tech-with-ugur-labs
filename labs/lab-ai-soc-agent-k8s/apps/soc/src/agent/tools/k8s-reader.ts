import type {
  AppsV1Api,
  BatchV1Api,
  CoreV1Api,
  NetworkingV1Api,
  RbacAuthorizationV1Api,
} from "@kubernetes/client-node";
import type {
  K8sReader,
  Kind,
  ReadRequest,
  SecretMetadataClient,
} from "./k8s-get.js";

export type ReaderApis = {
  core: CoreV1Api;
  apps: AppsV1Api;
  batch: BatchV1Api;
  networking: NetworkingV1Api;
  rbac: RbacAuthorizationV1Api;
};

type ListFn = (p: {
  namespace: string;
  labelSelector?: string;
}) => Promise<{ items: unknown[] }>;
type ListAllFn = (p: {
  labelSelector?: string;
}) => Promise<{ items: unknown[] }>;
type ReadNsFn = (p: { namespace: string; name: string }) => Promise<unknown>;
type ReadFn = (p: { name: string }) => Promise<unknown>;

type Calls =
  | { scope: "namespaced"; list: ListFn; listAll: ListAllFn; read: ReadNsFn }
  | { scope: "cluster"; listAll: ListAllFn; read: ReadFn };

const ns = (list: ListFn, listAll: ListAllFn, read: ReadNsFn): Calls => ({
  scope: "namespaced",
  list,
  listAll,
  read,
});
const cluster = (listAll: ListAllFn, read: ReadFn): Calls => ({
  scope: "cluster",
  listAll,
  read,
});

/** Maps each kind to its list/read calls; list and read verbs only. */
function callsFor(a: ReaderApis): Record<Kind, Calls> {
  return {
    pod: ns(
      (p) => a.core.listNamespacedPod(p),
      (p) => a.core.listPodForAllNamespaces(p),
      (p) => a.core.readNamespacedPod(p),
    ),
    service: ns(
      (p) => a.core.listNamespacedService(p),
      (p) => a.core.listServiceForAllNamespaces(p),
      (p) => a.core.readNamespacedService(p),
    ),
    serviceaccount: ns(
      (p) => a.core.listNamespacedServiceAccount(p),
      (p) => a.core.listServiceAccountForAllNamespaces(p),
      (p) => a.core.readNamespacedServiceAccount(p),
    ),
    event: ns(
      (p) => a.core.listNamespacedEvent(p),
      (p) => a.core.listEventForAllNamespaces(p),
      (p) => a.core.readNamespacedEvent(p),
    ),
    namespace: cluster(
      (p) => a.core.listNamespace(p),
      (p) => a.core.readNamespace(p),
    ),
    deployment: ns(
      (p) => a.apps.listNamespacedDeployment(p),
      (p) => a.apps.listDeploymentForAllNamespaces(p),
      (p) => a.apps.readNamespacedDeployment(p),
    ),
    replicaset: ns(
      (p) => a.apps.listNamespacedReplicaSet(p),
      (p) => a.apps.listReplicaSetForAllNamespaces(p),
      (p) => a.apps.readNamespacedReplicaSet(p),
    ),
    daemonset: ns(
      (p) => a.apps.listNamespacedDaemonSet(p),
      (p) => a.apps.listDaemonSetForAllNamespaces(p),
      (p) => a.apps.readNamespacedDaemonSet(p),
    ),
    statefulset: ns(
      (p) => a.apps.listNamespacedStatefulSet(p),
      (p) => a.apps.listStatefulSetForAllNamespaces(p),
      (p) => a.apps.readNamespacedStatefulSet(p),
    ),
    job: ns(
      (p) => a.batch.listNamespacedJob(p),
      (p) => a.batch.listJobForAllNamespaces(p),
      (p) => a.batch.readNamespacedJob(p),
    ),
    cronjob: ns(
      (p) => a.batch.listNamespacedCronJob(p),
      (p) => a.batch.listCronJobForAllNamespaces(p),
      (p) => a.batch.readNamespacedCronJob(p),
    ),
    networkpolicy: ns(
      (p) => a.networking.listNamespacedNetworkPolicy(p),
      (p) => a.networking.listNetworkPolicyForAllNamespaces(p),
      (p) => a.networking.readNamespacedNetworkPolicy(p),
    ),
    role: ns(
      (p) => a.rbac.listNamespacedRole(p),
      (p) => a.rbac.listRoleForAllNamespaces(p),
      (p) => a.rbac.readNamespacedRole(p),
    ),
    rolebinding: ns(
      (p) => a.rbac.listNamespacedRoleBinding(p),
      (p) => a.rbac.listRoleBindingForAllNamespaces(p),
      (p) => a.rbac.readNamespacedRoleBinding(p),
    ),
    clusterrole: cluster(
      (p) => a.rbac.listClusterRole(p),
      (p) => a.rbac.readClusterRole(p),
    ),
    clusterrolebinding: cluster(
      (p) => a.rbac.listClusterRoleBinding(p),
      (p) => a.rbac.readClusterRoleBinding(p),
    ),
  };
}

async function readOne(
  c: Calls,
  req: ReadRequest,
  name: string,
): Promise<unknown[]> {
  if (c.scope === "cluster") return [await c.read({ name })];
  if (!req.namespace) {
    throw new Error("a namespace is required to read one namespaced object");
  }
  return [await c.read({ namespace: req.namespace, name })];
}

async function listMany(c: Calls, req: ReadRequest): Promise<unknown[]> {
  const labelSelector = req.labelSelector;
  const sel = labelSelector ? { labelSelector } : {};
  if (c.scope === "namespaced" && req.namespace) {
    return (await c.list({ namespace: req.namespace, ...sel })).items;
  }
  return (await c.listAll(sel)).items;
}

export function createK8sReader(apis: ReaderApis): K8sReader {
  const calls = callsFor(apis);
  return {
    read: (kind, req) =>
      req.name
        ? readOne(calls[kind], req, req.name)
        : listMany(calls[kind], req),
  };
}

export function createSecretMetadataClient(
  baseUrl: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): SecretMetadataClient {
  return {
    read: async (namespace, name) => {
      const path = name
        ? `/secrets/${namespace}/${name}`
        : `/secrets/${namespace}`;
      const res = await fetchFn(new URL(path, baseUrl).toString(), {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new Error(`Responder returned ${res.status} for secret metadata`);
      }
      return (await res.json()) as unknown[];
    },
  };
}
