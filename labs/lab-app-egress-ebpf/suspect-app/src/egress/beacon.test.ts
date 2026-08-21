import { describe, expect, it } from "vitest";
import { sendBeacon } from "./beacon.js";
import { createLogger } from "../logger.js";
import { buildFingerprint } from "../fingerprint.js";

const logger = createLogger({ appName: "test" });

describe("sendBeacon", () => {
  it("resolves (never throws) even when the destination is unreachable", async () => {
    // Port 1 on an unroutable address: the connection fails fast. Spyware must
    // not crash its host process on a failed beacon — sendBeacon swallows it.
    await expect(
      sendBeacon("https://127.0.0.1:1/collect", buildFingerprint(), "/nonexistent-ca.pem", logger),
    ).resolves.toBeUndefined();
  });
});
