import { describe, expect, it } from "vitest";
import { describeError } from "./describe-error.js";

describe("describeError", () => {
  it("keeps the name and the HTTP status, and drops the message", () => {
    const err = Object.assign(
      new Error("Could not read /home/node/.aws/login/cache/abc.json"),
      { name: "CredentialsProviderError", $metadata: { httpStatusCode: 403 } },
    );
    const described = describeError(err);
    expect(described).toEqual({
      errorName: "CredentialsProviderError",
      httpStatusCode: 403,
    });
    expect(JSON.stringify(described)).not.toContain(".aws");
  });

  it("handles values that are not errors", () => {
    expect(describeError("boom")).toEqual({ errorName: "UnknownError" });
    expect(describeError(null)).toEqual({ errorName: "UnknownError" });
  });
});
