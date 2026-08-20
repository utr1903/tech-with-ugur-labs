import { describe, expect, it } from "vitest";
import { parseCapture } from "./capture.js";

const JSONL = [
  '{"event":"clienthello","sni":"updates.goodvendor.lab"}',
  '{"event":"request","host":"updates.goodvendor.lab","method":"GET","path":"/version","body":null}',
  '{"event":"clienthello","sni":"cdn-metrics.tracklab.lab"}',
  '{"event":"request","host":"cdn-metrics.tracklab.lab","method":"POST","path":"/beacon","body":"{\\"fingerprint\\":\\"FAKE-FP-000-lab-only\\"}"}',
  '{"event":"clienthello","sni":"pin.evil-c2.lab"}',
  '{"event":"tls_failed_client","sni":"pin.evil-c2.lab"}',
  "",
].join("\n");

describe("parseCapture", () => {
  it("marks a host with a decrypted request", () => {
    const ev = parseCapture(JSONL).get("cdn-metrics.tracklab.lab");
    expect(ev).toMatchObject({ decrypted: true, sniSeen: true, tlsFailed: false });
    expect(ev?.payload).toContain("FAKE-FP-000-lab-only");
  });

  it("marks a pinned host as SNI-seen + tls-failed, not decrypted", () => {
    expect(parseCapture(JSONL).get("pin.evil-c2.lab")).toMatchObject({
      decrypted: false,
      sniSeen: true,
      tlsFailed: true,
    });
  });

  it("tolerates blank lines", () => {
    expect(parseCapture(JSONL).has("updates.goodvendor.lab")).toBe(true);
  });
});
