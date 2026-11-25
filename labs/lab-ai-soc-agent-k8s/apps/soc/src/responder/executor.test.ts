import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import type { ActionKind } from "../shared/actions.js";
import { createExecutor } from "./executor.js";
import { createFakeCluster } from "./fake-apis.js";
import { makeProposal, quarantine } from "./fixtures.js";

const logger = createLogger({ appName: "executor-test" });

function setup() {
  const cluster = createFakeCluster();
  return { cluster, executor: createExecutor(cluster.apis, logger) };
}

describe("executor: quarantine_pod", () => {
  it("creates the soc-quarantine NetworkPolicy and labels the pod", async () => {
    const { cluster, executor } = setup();
    await executor.execute(quarantine("p1", "storefront", "web-1"));

    const policy = cluster.policies.get("storefront/soc-quarantine");
    expect(policy?.spec?.podSelector?.matchLabels).toEqual({
      "soc.quarantine": "true",
    });
    expect(policy?.spec?.policyTypes).toEqual(["Ingress", "Egress"]);
    expect(policy?.spec?.ingress).toBeUndefined();
    expect(policy?.spec?.egress).toBeUndefined();

    const patch = cluster.calls.find((c) => c.method === "patchNamespacedPod");
    expect(patch?.args).toMatchObject({
      name: "web-1",
      namespace: "storefront",
      body: { metadata: { labels: { "soc.quarantine": "true" } } },
    });
  });

  it("does not create the policy again when it already exists", async () => {
    const { cluster, executor } = setup();
    await executor.execute(quarantine("p1", "storefront", "web-1"));
    await executor.execute(quarantine("p2", "storefront", "web-2"));
    const creates = cluster.calls.filter(
      (c) => c.method === "createNamespacedNetworkPolicy",
    );
    expect(creates).toHaveLength(1);
  });

  it("never deletes a pod", async () => {
    const { cluster, executor } = setup();
    await executor.execute(quarantine("p1", "storefront", "web-1"));
    expect(cluster.calls.some((c) => c.method.startsWith("delete"))).toBe(
      false,
    );
  });
});

describe("executor: scale_to_zero", () => {
  it("patches the deployment scale subresource to 0 replicas", async () => {
    const { cluster, executor } = setup();
    await executor.execute(
      makeProposal("p1", "scale_to_zero", {
        namespace: "batch",
        name: "report",
        resource: "deployment",
      }),
    );
    const call = cluster.calls[0];
    expect(call?.method).toBe("patchNamespacedDeploymentScale");
    expect(call?.args).toMatchObject({
      name: "report",
      namespace: "batch",
      body: { spec: { replicas: 0 } },
    });
  });

  it("patches a statefulset scale when asked", async () => {
    const { cluster, executor } = setup();
    await executor.execute(
      makeProposal("p1", "scale_to_zero", {
        namespace: "batch",
        name: "db",
        resource: "statefulset",
      }),
    );
    expect(cluster.calls[0]?.method).toBe("patchNamespacedStatefulSetScale");
  });
});

describe("executor: revoke_binding", () => {
  it("deletes a rolebinding", async () => {
    const { cluster, executor } = setup();
    await executor.execute(
      makeProposal("p1", "revoke_binding", {
        namespace: "ci",
        name: "deployer",
        resource: "rolebinding",
      }),
    );
    expect(cluster.calls[0]).toMatchObject({
      method: "deleteNamespacedRoleBinding",
      args: { name: "deployer", namespace: "ci" },
    });
  });

  it("deletes a clusterrolebinding", async () => {
    const { cluster, executor } = setup();
    await executor.execute(
      makeProposal("p1", "revoke_binding", {
        name: "node-agent-cluster-admin",
        resource: "clusterrolebinding",
      }),
    );
    expect(cluster.calls[0]).toMatchObject({
      method: "deleteClusterRoleBinding",
      args: { name: "node-agent-cluster-admin" },
    });
  });
});

describe("executor: rotate_secret", () => {
  it("replaces every key with 32 random hex chars and annotates the secret", async () => {
    const { cluster, executor } = setup();
    cluster.secrets.set("payments/db", {
      metadata: { name: "db", namespace: "payments", resourceVersion: "7" },
      data: {
        password: Buffer.from("LAB-FAKE-old").toString("base64"),
        user: Buffer.from("LAB-FAKE-user").toString("base64"),
      },
    });
    await executor.execute(
      makeProposal("p1", "rotate_secret", {
        namespace: "payments",
        name: "db",
      }),
    );

    const stored = cluster.secrets.get("payments/db");
    expect(Object.keys(stored?.data ?? {}).sort()).toEqual([
      "password",
      "user",
    ]);
    for (const value of Object.values(stored?.data ?? {})) {
      expect(Buffer.from(value, "base64").toString()).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(stored?.data?.password).not.toBe(stored?.data?.user);
    expect(stored?.metadata?.annotations?.["soc.lab/rotated-at"]).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
    expect(stored?.metadata?.resourceVersion).toBe("7");
  });

  it("fails for a secret with no keys", async () => {
    const { cluster, executor } = setup();
    cluster.secrets.set("payments/empty", {
      metadata: { name: "empty", namespace: "payments" },
    });
    await expect(
      executor.execute(
        makeProposal("p1", "rotate_secret", {
          namespace: "payments",
          name: "empty",
        }),
      ),
    ).rejects.toThrow("no keys");
  });
});

describe("executor: failures", () => {
  it("rethrows API errors so the caller can record a failed outcome", async () => {
    const { cluster, executor } = setup();
    cluster.failWith(new Error("forbidden"));
    await expect(
      executor.execute(quarantine("p1", "storefront", "web-1")),
    ).rejects.toThrow("forbidden");
  });

  it("refuses an unknown kind", async () => {
    const { executor } = setup();
    await expect(
      executor.execute(
        makeProposal("p1", "delete_pod" as ActionKind, {
          namespace: "a",
          name: "b",
        }),
      ),
    ).rejects.toThrow("unsupported");
  });
});
