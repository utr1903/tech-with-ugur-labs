import { describe, expect, it } from "vitest";
import { DRIVE_READONLY_SCOPE, DRIVE_WRITE_SCOPE, impersonationOptions } from "./auth.js";

describe("impersonationOptions", () => {
  it("targets the service account and asks only for the scopes given", () => {
    const options = impersonationOptions("sa@p.iam.gserviceaccount.com", [DRIVE_READONLY_SCOPE]);

    expect(options.targetPrincipal).toBe("sa@p.iam.gserviceaccount.com");
    expect(options.targetScopes).toEqual([DRIVE_READONLY_SCOPE]);
  });

  it("uses no delegates, so the caller needs Token Creator directly", () => {
    expect(
      impersonationOptions("sa@p.iam.gserviceaccount.com", [DRIVE_WRITE_SCOPE]).delegates,
    ).toEqual([]);
  });

  it("keeps tokens short-lived", () => {
    expect(impersonationOptions("sa@p.iam.gserviceaccount.com", [DRIVE_WRITE_SCOPE]).lifetime).toBe(
      3600,
    );
  });

  it("refuses an empty scope list rather than minting an unscoped token", () => {
    expect(() => impersonationOptions("sa@p.iam.gserviceaccount.com", [])).toThrow(/scope/i);
  });

  it("keeps the read-only and write scopes distinct", () => {
    expect(DRIVE_READONLY_SCOPE).toBe("https://www.googleapis.com/auth/drive.readonly");
    expect(DRIVE_WRITE_SCOPE).toBe("https://www.googleapis.com/auth/drive");
    expect(DRIVE_READONLY_SCOPE).not.toBe(DRIVE_WRITE_SCOPE);
  });
});
