import { describe, expect, it } from "vitest";
import { sanitizeObject } from "./sanitize.js";

describe("sanitizeObject", () => {
  it("redacts env values but keeps names", () => {
    const out = sanitizeObject({
      spec: {
        containers: [
          {
            env: [
              { name: "DB_PASSWORD", value: "hunter2" },
              {
                name: "FROM_SECRET",
                valueFrom: { secretKeyRef: { name: "s", key: "k" } },
              },
            ],
          },
        ],
      },
    }) as { spec: { containers: { env: Record<string, unknown>[] }[] } };
    const env = out.spec.containers[0]?.env;
    expect(env?.[0]).toEqual({
      name: "DB_PASSWORD",
      value: "<redacted len=7>",
    });
    expect(env?.[1]).toEqual({
      name: "FROM_SECRET",
      valueFrom: { secretKeyRef: { name: "s", key: "k" } },
    });
  });

  it("drops managedFields and the last-applied annotation", () => {
    const out = sanitizeObject({
      metadata: {
        name: "a",
        managedFields: [{ manager: "kubectl" }],
        annotations: {
          keep: "yes",
          "kubectl.kubernetes.io/last-applied-configuration":
            '{"env":"secret"}',
        },
      },
    }) as { metadata: Record<string, unknown> };
    expect(out.metadata.managedFields).toBeUndefined();
    expect(out.metadata.annotations).toEqual({ keep: "yes" });
  });

  it("keeps only type and status of status.conditions", () => {
    const out = sanitizeObject({
      status: {
        conditions: [
          {
            type: "Ready",
            status: "True",
            message: "noise",
            lastTransitionTime: "t",
          },
        ],
      },
    }) as { status: { conditions: unknown[] } };
    expect(out.status.conditions).toEqual([{ type: "Ready", status: "True" }]);
  });

  it("truncates any string over 2000 chars", () => {
    const out = sanitizeObject({ data: { blob: "y".repeat(5000) } }) as {
      data: { blob: string };
    };
    expect(out.data.blob.length).toBeLessThan(2100);
    expect(out.data.blob).toContain("truncated");
  });

  it("serialises dates to ISO strings", () => {
    const out = sanitizeObject({ at: new Date("2026-01-01T00:00:00Z") }) as {
      at: string;
    };
    expect(out.at).toBe("2026-01-01T00:00:00.000Z");
  });
});
