import { randomBytes } from "node:crypto";
import type { CoreV1Api } from "@kubernetes/client-node";
import type { ActionProposal } from "../shared/actions.js";

const ROTATED_AT_ANNOTATION = "soc.lab/rotated-at";

/** 32 random hex chars, base64-encoded the way Secret.data expects. */
function newValue(): string {
  return Buffer.from(randomBytes(16).toString("hex")).toString("base64");
}

/**
 * Replace every key of the secret with fresh random material and stamp
 * the rotation time. Old values are never logged or returned.
 */
export async function rotateSecret(
  core: Pick<CoreV1Api, "readNamespacedSecret" | "replaceNamespacedSecret">,
  p: ActionProposal,
): Promise<void> {
  const name = p.target.name;
  const namespace = p.target.namespace ?? "";
  const secret = await core.readNamespacedSecret({ name, namespace });
  const keys = Object.keys(secret.data ?? {});
  if (keys.length === 0)
    throw new Error(`secret ${namespace}/${name} has no keys`);
  const body = {
    ...secret,
    data: Object.fromEntries(keys.map((k) => [k, newValue()])),
    metadata: {
      ...secret.metadata,
      annotations: {
        ...secret.metadata?.annotations,
        [ROTATED_AT_ANNOTATION]: new Date().toISOString(),
      },
    },
  };
  await core.replaceNamespacedSecret({ name, namespace, body });
}
