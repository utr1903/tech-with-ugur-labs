import { describe, expect, it, vi } from "vitest";
import { createK8sReader, createSecretMetadataClient } from "./k8s-reader.js";

function apis() {
  return {
    core: {
      listNamespacedPod: vi.fn(async () => ({ items: [{ a: 1 }] })),
      listPodForAllNamespaces: vi.fn(async () => ({ items: [] })),
      readNamespacedPod: vi.fn(async () => ({ b: 2 })),
      listNamespace: vi.fn(async () => ({ items: [] })),
      listNamespacedEvent: vi.fn(async () => ({ items: [{ e: 1 }] })),
    },
    rbac: { readClusterRoleBinding: vi.fn(async () => ({ c: 3 })) },
  };
}

describe("createK8sReader", () => {
  it("lists a namespaced kind with the label selector", async () => {
    const a = apis();
    const reader = createK8sReader(a as never);
    const items = await reader.read("pod", {
      namespace: "batch",
      labelSelector: "app=x",
    });
    expect(a.core.listNamespacedPod).toHaveBeenCalledWith({
      namespace: "batch",
      labelSelector: "app=x",
    });
    expect(items).toEqual([{ a: 1 }]);
  });

  it("lists across namespaces when none is given", async () => {
    const a = apis();
    await createK8sReader(a as never).read("pod", {});
    expect(a.core.listPodForAllNamespaces).toHaveBeenCalled();
  });

  it("reads one object by name and wraps it in an array", async () => {
    const a = apis();
    const items = await createK8sReader(a as never).read("pod", {
      namespace: "batch",
      name: "p",
    });
    expect(a.core.readNamespacedPod).toHaveBeenCalledWith({
      namespace: "batch",
      name: "p",
    });
    expect(items).toEqual([{ b: 2 }]);
  });

  it("reads cluster-scoped kinds without a namespace", async () => {
    const a = apis();
    const items = await createK8sReader(a as never).read("clusterrolebinding", {
      name: "x",
    });
    expect(a.rbac.readClusterRoleBinding).toHaveBeenCalledWith({ name: "x" });
    expect(items).toEqual([{ c: 3 }]);
  });

  it("reads events from core/v1", async () => {
    const a = apis();
    await createK8sReader(a as never).read("event", { namespace: "ci" });
    expect(a.core.listNamespacedEvent).toHaveBeenCalledWith({
      namespace: "ci",
    });
  });
});

describe("createSecretMetadataClient", () => {
  it("sends the bearer token to the responder", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify([{ name: "s" }]), { status: 200 }),
    );
    const client = createSecretMetadataClient(
      "http://responder:8081",
      "tok",
      fetchFn,
    );
    const items = await client.read("payments", "s");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(String(url)).toBe("http://responder:8081/secrets/payments/s");
    expect(
      ((init?.headers ?? {}) as Record<string, string>).authorization,
    ).toBe("Bearer tok");
    expect(items).toEqual([{ name: "s" }]);
  });

  it("lists a namespace when no name is given and fails on non-2xx", async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response("no", { status: 404 }),
    );
    const client = createSecretMetadataClient(
      "http://responder:8081",
      "tok",
      fetchFn,
    );
    await expect(client.read("payments")).rejects.toThrow(/404/);
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe(
      "http://responder:8081/secrets/payments",
    );
  });
});
