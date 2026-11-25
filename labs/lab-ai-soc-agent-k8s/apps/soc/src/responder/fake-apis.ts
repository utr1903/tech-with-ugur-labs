import type { V1NetworkPolicy, V1Secret } from "@kubernetes/client-node";
import { ApiException } from "@kubernetes/client-node";
import type { K8sApis } from "./executor.js";

type Call = { api: string; method: string; args: unknown };

export type FakeCluster = {
  apis: K8sApis;
  calls: Call[];
  policies: Map<string, V1NetworkPolicy>;
  secrets: Map<string, V1Secret>;
  /** Make every following API call throw this error. */
  failWith(err: Error): void;
};

/** Typed in-memory stand-in for the four Kubernetes APIs the executor uses. */
export function createFakeCluster(): FakeCluster {
  const calls: Call[] = [];
  const policies = new Map<string, V1NetworkPolicy>();
  const secrets = new Map<string, V1Secret>();
  let failure: Error | undefined;
  const record = (api: string, method: string, args: unknown): void => {
    calls.push({ api, method, args });
    if (failure) throw failure;
  };
  const apis: K8sApis = {
    core: {
      patchNamespacedPod: async (req) => {
        record("core", "patchNamespacedPod", req);
        return {};
      },
      readNamespacedSecret: async (req) => {
        record("core", "readNamespacedSecret", req);
        const found = secrets.get(`${req.namespace}/${req.name}`);
        if (!found) throw new ApiException(404, "not found", {}, {});
        return structuredClone(found);
      },
      replaceNamespacedSecret: async (req) => {
        record("core", "replaceNamespacedSecret", req);
        secrets.set(`${req.namespace}/${req.name}`, req.body);
        return req.body;
      },
      listNamespacedSecret: async (req) => {
        record("core", "listNamespacedSecret", req);
        const prefix = `${req.namespace}/`;
        return {
          items: [...secrets]
            .filter(([k]) => k.startsWith(prefix))
            .map(([, v]) => v),
        };
      },
    },
    apps: {
      patchNamespacedDeploymentScale: async (req) => {
        record("apps", "patchNamespacedDeploymentScale", req);
        return {};
      },
      patchNamespacedStatefulSetScale: async (req) => {
        record("apps", "patchNamespacedStatefulSetScale", req);
        return {};
      },
    },
    networking: {
      readNamespacedNetworkPolicy: async (req) => {
        record("networking", "readNamespacedNetworkPolicy", req);
        const found = policies.get(`${req.namespace}/${req.name}`);
        if (!found) throw new ApiException(404, "not found", {}, {});
        return found;
      },
      createNamespacedNetworkPolicy: async (req) => {
        record("networking", "createNamespacedNetworkPolicy", req);
        policies.set(`${req.namespace}/${req.body.metadata?.name}`, req.body);
        return req.body;
      },
    },
    rbac: {
      deleteNamespacedRoleBinding: async (req) => {
        record("rbac", "deleteNamespacedRoleBinding", req);
        return {};
      },
      deleteClusterRoleBinding: async (req) => {
        record("rbac", "deleteClusterRoleBinding", req);
        return {};
      },
    },
  };
  return {
    apis,
    calls,
    policies,
    secrets,
    failWith: (err) => {
      failure = err;
    },
  };
}
