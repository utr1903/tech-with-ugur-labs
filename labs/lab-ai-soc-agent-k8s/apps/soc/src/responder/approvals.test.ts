import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ApprovalAlreadyResolvedError,
  ApprovalNotFoundError,
  createApprovalStore,
} from "./approvals.js";
import { quarantine } from "./fixtures.js";

async function tmpFile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "soc-appr-")), "approvals.json");
}

describe("approval store", () => {
  it("adds a pending approval, lists it and resolves it", async () => {
    const store = createApprovalStore(await tmpFile());
    const added = await store.add("inv-1", quarantine("p1", "storefront"));
    expect(added.state).toBe("pending");
    expect((await store.list()).map((a) => a.id)).toEqual([added.id]);

    const resolved = await store.resolve(added.id, "approved");
    expect(resolved.state).toBe("approved");
    expect(resolved.resolvedAt).toBeDefined();
    expect((await store.list())[0]?.state).toBe("approved");
  });

  it("throws when an approval is resolved twice", async () => {
    const store = createApprovalStore(await tmpFile());
    const a = await store.add("inv-1", quarantine("p1", "storefront"));
    await store.resolve(a.id, "denied");
    await expect(store.resolve(a.id, "approved")).rejects.toBeInstanceOf(
      ApprovalAlreadyResolvedError,
    );
  });

  it("throws for an unknown id", async () => {
    const store = createApprovalStore(await tmpFile());
    await expect(store.resolve("nope", "approved")).rejects.toBeInstanceOf(
      ApprovalNotFoundError,
    );
  });

  it("survives a reload from the file", async () => {
    const file = await tmpFile();
    const a = await createApprovalStore(file).add(
      "inv-1",
      quarantine("p1", "storefront"),
    );
    const reloaded = await createApprovalStore(file).list();
    expect(reloaded).toEqual([a]);
  });

  it("does not lose approvals added concurrently", async () => {
    const store = createApprovalStore(await tmpFile());
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.add("inv-1", quarantine(`p${i}`, "storefront", `pod-${i}`)),
      ),
    );
    expect(await store.list()).toHaveLength(20);
  });

  it("lets only one of two concurrent resolves win", async () => {
    const store = createApprovalStore(await tmpFile());
    const a = await store.add("inv-1", quarantine("p1", "storefront"));
    const results = await Promise.allSettled([
      store.resolve(a.id, "approved"),
      store.resolve(a.id, "approved"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});
