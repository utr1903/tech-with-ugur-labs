import { describe, expect, it } from "vitest";
import { toHttpError } from "./http-error.js";

function named(name: string, cause?: unknown): Error {
  const err = new Error(`details with /home/node/.aws/login/cache`, { cause });
  err.name = name;
  return err;
}

describe("toHttpError", () => {
  it.each([
    ["CredentialsProviderError", 502, "AWS_LOGIN_REQUIRED"],
    ["ExpiredTokenException", 502, "AWS_LOGIN_REQUIRED"],
    ["UnrecognizedClientException", 502, "AWS_LOGIN_REQUIRED"],
    ["AccessDeniedException", 502, "MODEL_ACCESS_DENIED"],
    ["ValidationException", 502, "MODEL_UNAVAILABLE"],
    ["ResourceNotFoundException", 502, "MODEL_UNAVAILABLE"],
    ["ThrottlingException", 502, "BEDROCK_ERROR"],
    ["ServiceUnavailableException", 502, "BEDROCK_ERROR"],
    ["ModelTimeoutException", 502, "BEDROCK_ERROR"],
    ["GraphRecursionError", 504, "AGENT_LIMIT_REACHED"],
    ["TimeoutError", 504, "REQUEST_TIMEOUT"],
    ["AbortError", 504, "REQUEST_TIMEOUT"],
    ["TypeError", 500, "INTERNAL_ERROR"],
  ])("maps %s to %i %s", (name, status, code) => {
    expect(toHttpError(named(name))).toMatchObject({ status, code });
  });

  it("finds the AWS error when it is wrapped as a cause", () => {
    const wrapped = named(
      "Error",
      named("Error", named("ExpiredTokenException")),
    );
    expect(toHttpError(wrapped).code).toBe("AWS_LOGIN_REQUIRED");
  });

  it("tells the reader to sign in again", () => {
    expect(toHttpError(named("ExpiredTokenException")).message).toContain(
      "make login",
    );
  });

  it("never passes the original message on", () => {
    for (const name of [
      "CredentialsProviderError",
      "TypeError",
      "ValidationException",
    ]) {
      expect(toHttpError(named(name)).message).not.toContain(".aws");
    }
  });

  it("handles values that are not errors", () => {
    expect(toHttpError("boom")).toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
    });
  });
});
