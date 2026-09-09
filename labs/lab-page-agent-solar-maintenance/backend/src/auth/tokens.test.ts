import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "./tokens.js";

const secret = "test-secret-value";

describe("session tokens", () => {
  it("round-trips a user", async () => {
    const token = await signSession(
      { id: "u-1", name: "Rosa Iglesias" },
      secret,
    );
    const user = await verifySession(token, secret);
    expect(user).toEqual({ id: "u-1", name: "Rosa Iglesias" });
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signSession(
      { id: "u-1", name: "Rosa Iglesias" },
      "other-secret",
    );
    await expect(verifySession(token, secret)).rejects.toThrow();
  });

  it("rejects a malformed token", async () => {
    await expect(verifySession("not-a-jwt", secret)).rejects.toThrow();
  });
});
