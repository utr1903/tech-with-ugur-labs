import type { CoreV1Api, V1Secret } from "@kubernetes/client-node";
import { isNotFound } from "./k8s-errors.js";

export type SecretMetadata = {
  name: string;
  namespace: string;
  type: string;
  keys: string[];
  annotations: Record<string, string>;
  createdAt: string;
};

/** Holds a full copy of the object, values included, so it must never be shown. */
const LAST_APPLIED = "kubectl.kubernetes.io/last-applied-configuration";

/**
 * The only shape in which secrets leave the responder: names and key
 * names, never values. data and stringData are read for their keys only.
 */
export function toSecretMetadata(secret: V1Secret): SecretMetadata {
  const keys = new Set([
    ...Object.keys(secret.data ?? {}),
    ...Object.keys(secret.stringData ?? {}),
  ]);
  const { [LAST_APPLIED]: _omitted, ...annotations } =
    secret.metadata?.annotations ?? {};
  return {
    name: secret.metadata?.name ?? "",
    namespace: secret.metadata?.namespace ?? "",
    type: secret.type ?? "",
    keys: [...keys].sort(),
    annotations,
    createdAt: secret.metadata?.creationTimestamp?.toISOString() ?? "",
  };
}

export type SecretReader = {
  list(namespace: string): Promise<SecretMetadata[]>;
  /** Undefined when the secret does not exist. */
  get(namespace: string, name: string): Promise<SecretMetadata | undefined>;
};

export function createSecretReader(
  core: Pick<CoreV1Api, "listNamespacedSecret" | "readNamespacedSecret">,
): SecretReader {
  return {
    list: async (namespace) => {
      const res = await core.listNamespacedSecret({ namespace });
      return res.items.map(toSecretMetadata);
    },
    get: async (namespace, name) => {
      try {
        return toSecretMetadata(
          await core.readNamespacedSecret({ name, namespace }),
        );
      } catch (err) {
        if (isNotFound(err)) return undefined;
        throw err;
      }
    },
  };
}
