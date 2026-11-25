import { describe, expect, it, vi } from "vitest";
import { buildK8sGet } from "./k8s-get.js";
import { asText, descriptionOf, makeDeps, unwrapJson } from "./test-support.js";

describe("k8s_get", () => {
  it("secret kind goes to the metadata client", async () => {
    const secrets = { read: vi.fn(async () => [{ name: "s", keys: ["a"] }]) };
    const k8s = { read: vi.fn(async () => []) };
    const tool = buildK8sGet(makeDeps({ secrets, k8s }));
    const out = unwrapJson(
      await tool.run({ kind: "secret", namespace: "payments", name: "s" }),
    ) as {
      items: unknown[];
    };
    expect(secrets.read).toHaveBeenCalledWith("payments", "s");
    expect(k8s.read).not.toHaveBeenCalled();
    expect(out.items).toEqual([{ name: "s", keys: ["a"] }]);
  });

  it("requires a namespace for secrets", async () => {
    const tool = buildK8sGet(makeDeps());
    const out = JSON.parse(asText(await tool.run({ kind: "secret" })));
    expect(out.error.code).toBe("namespace_required");
  });

  it("sanitizes objects and caps results at 50", async () => {
    const pods = Array.from({ length: 80 }, (_, i) => ({
      metadata: { name: `p${i}`, managedFields: [1] },
    }));
    const k8s = { read: vi.fn(async () => pods) };
    const tool = buildK8sGet(makeDeps({ k8s }));
    const out = unwrapJson(
      await tool.run({
        kind: "pod",
        namespace: "batch",
        label_selector: "app=x",
      }),
    ) as {
      count: number;
      truncated: boolean;
      items: { metadata: Record<string, unknown> }[];
    };
    expect(k8s.read).toHaveBeenCalledWith("pod", {
      namespace: "batch",
      name: undefined,
      labelSelector: "app=x",
    });
    expect(out.items).toHaveLength(50);
    expect(out.count).toBe(80);
    expect(out.truncated).toBe(true);
    expect(out.items[0]?.metadata.managedFields).toBeUndefined();
  });

  it("returns a structured error when the API call fails", async () => {
    const k8s = {
      read: async () => {
        throw new Error("forbidden");
      },
    };
    const tool = buildK8sGet(makeDeps({ k8s }));
    const out = JSON.parse(asText(await tool.run({ kind: "pod" })));
    expect(out.error.message).toContain("forbidden");
  });

  it("documents when to use and not use it", () => {
    const tool = buildK8sGet(makeDeps());
    expect(descriptionOf(tool)).toContain("Use for:");
    expect(descriptionOf(tool)).toContain("Do NOT use for:");
  });
});
