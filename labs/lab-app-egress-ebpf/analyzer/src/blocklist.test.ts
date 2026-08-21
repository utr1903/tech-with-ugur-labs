import { describe, expect, it } from "vitest";
import { parseBlocklist } from "./blocklist.js";

describe("parseBlocklist", () => {
  it("takes the hostname column, ignoring comments and blanks", () => {
    const set = parseBlocklist("# c\n0.0.0.0 telemetry.adnexus.lab\n\n0.0.0.0 X.invalid\n");
    expect(set.has("telemetry.adnexus.lab")).toBe(true);
    expect(set.has("x.invalid")).toBe(true);
    expect(set.has("updates.goodvendor.lab")).toBe(false);
  });
});
