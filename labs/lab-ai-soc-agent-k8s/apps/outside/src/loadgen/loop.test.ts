import { describe, expect, it } from "vitest";
import { pickRequest } from "./loop.js";

describe("pickRequest", () => {
  it("returns only the two allowed request shapes", () => {
    const paths = new Set<string>();
    for (let i = 0; i < 100; i++) paths.add(pickRequest(() => i / 100).path);
    expect([...paths].sort()).toEqual([
      "/preview?url=http://payments-api.payments.svc/healthz",
      "/products",
    ]);
  });
});
