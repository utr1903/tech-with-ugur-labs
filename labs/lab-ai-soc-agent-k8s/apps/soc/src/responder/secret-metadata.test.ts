import type { V1Secret } from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";
import { toSecretMetadata } from "./secret-metadata.js";

const secret: V1Secret = {
  metadata: {
    name: "db",
    namespace: "payments",
    creationTimestamp: new Date("2026-11-01T10:00:00Z"),
    annotations: {
      owner: "payments",
      "kubectl.kubernetes.io/last-applied-configuration":
        '{"data":{"password":"TEFCLUZBS0U="}}',
    },
  },
  type: "Opaque",
  data: { password: "TEFCLUZBS0U=", apikey: "a2V5" },
  stringData: { plain: "LAB-FAKE-plain" },
};

describe("toSecretMetadata", () => {
  it("returns sorted key names and identity fields", () => {
    expect(toSecretMetadata(secret)).toEqual({
      name: "db",
      namespace: "payments",
      type: "Opaque",
      keys: ["apikey", "password", "plain"],
      annotations: { owner: "payments" },
      createdAt: "2026-11-01T10:00:00.000Z",
    });
  });

  it("never contains a secret value anywhere in the output", () => {
    const text = JSON.stringify(toSecretMetadata(secret));
    for (const leak of ["TEFCLUZBS0U=", "a2V5", "LAB-FAKE-plain"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("tolerates a secret with no data", () => {
    const m = toSecretMetadata({ metadata: { name: "e", namespace: "n" } });
    expect(m.keys).toEqual([]);
    expect(m.annotations).toEqual({});
  });
});
