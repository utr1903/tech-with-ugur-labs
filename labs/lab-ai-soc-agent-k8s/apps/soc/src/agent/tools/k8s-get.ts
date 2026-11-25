import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { sanitizeObject } from "./sanitize.js";
import { runLogged, ToolFailure } from "./tool-run.js";
import type { ToolDeps } from "./types.js";
import { wrapUntrusted } from "./untrusted.js";

const KINDS = [
  "pod",
  "deployment",
  "replicaset",
  "daemonset",
  "statefulset",
  "job",
  "cronjob",
  "service",
  "networkpolicy",
  "serviceaccount",
  "namespace",
  "event",
  "role",
  "rolebinding",
  "clusterrole",
  "clusterrolebinding",
  "secret",
] as const;

export type Kind = Exclude<(typeof KINDS)[number], "secret">;
export type ReadRequest = {
  namespace?: string;
  name?: string;
  labelSelector?: string;
};

/** Read-only view of the Kubernetes API (the agent's ServiceAccount cannot write). */
export type K8sReader = {
  read(kind: Kind, req: ReadRequest): Promise<unknown[]>;
};

/** Secret names and key names only, served by the responder. */
export type SecretMetadataClient = {
  read(namespace: string, name?: string): Promise<unknown[]>;
};

const MAX_ITEMS = 50;

const InputSchema = z.object({
  kind: z.enum(KINDS).describe("Kind of object to read."),
  namespace: z
    .string()
    .max(253)
    .optional()
    .describe(
      "Namespace. Omit to list across all namespaces (not for secrets, which need one) or for cluster-scoped kinds.",
    ),
  name: z.string().max(253).optional().describe("Object name. Omit to list."),
  label_selector: z
    .string()
    .max(500)
    .optional()
    .describe('Label selector for lists, such as "app=web,tier=frontend".'),
});

const DESCRIPTION = `Read Kubernetes objects (read-only, at most ${MAX_ITEMS} per call). Env values are redacted (names kept), managed fields are dropped, and secrets return only name, type, key names, annotations and creation time, never values.
Use for: inspecting pods, workloads, service accounts, role bindings, network policies and events involved in an alert; checking who a binding grants access to; listing a secret's key names.
Do NOT use for: reading logs (use query_logs), changing anything (use the response tools), or reading secret values (impossible by design).`;

async function fetchItems(
  deps: ToolDeps,
  args: z.infer<typeof InputSchema>,
): Promise<unknown[]> {
  if (args.kind === "secret") {
    if (!args.namespace) {
      throw new ToolFailure(
        "namespace_required",
        "kind secret needs a namespace.",
      );
    }
    return deps.secrets.read(args.namespace, args.name);
  }
  return deps.k8s.read(args.kind, {
    namespace: args.namespace,
    name: args.name,
    labelSelector: args.label_selector,
  });
}

async function execute(
  deps: ToolDeps,
  args: z.infer<typeof InputSchema>,
): Promise<string> {
  const all = await fetchItems(deps, args);
  const items = all.slice(0, MAX_ITEMS).map(sanitizeObject);
  const body = {
    kind: args.kind,
    count: all.length,
    truncated: all.length > MAX_ITEMS,
    items,
  };
  return wrapUntrusted("k8s_get", JSON.stringify(body));
}

export function buildK8sGet(deps: ToolDeps) {
  return betaZodTool({
    name: "k8s_get",
    description: DESCRIPTION,
    inputSchema: InputSchema,
    run: (args) =>
      runLogged(deps.logger, "k8s_get", args, () => execute(deps, args)),
  });
}
