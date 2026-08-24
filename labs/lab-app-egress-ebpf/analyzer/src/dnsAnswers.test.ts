import { describe, expect, it } from "vitest";
import { dnsAnswers, fqdnForIp } from "./dnsAnswers.js";
import { parseEvents } from "./events.js";

const dnsEvent = (name: string, ip: string, ts: number) =>
  JSON.stringify({
    eventName: "net_packet_dns", processId: 7, parentProcessId: 1,
    processName: "node", timestamp: ts,
    args: [{ name: "proto_dns", value: {
      QR: 1, questions: [{ name, type: "A" }],
      answers: [{ name, type: "A", IP: ip }],
    } }],
  });

describe("dnsAnswers", () => {
  it("extracts fqdn→ip answers from A responses", () => {
    const a = dnsAnswers(parseEvents(dnsEvent("telemetry.adnexus.lab", "10.10.0.12", 5)));
    expect(a).toEqual([{ fqdn: "telemetry.adnexus.lab", ip: "10.10.0.12", timestamp: 5 }]);
  });

  it("fqdnForIp returns the latest answer at or before the connect", () => {
    const a = dnsAnswers(
      parseEvents([dnsEvent("a.lab", "10.10.0.11", 1), dnsEvent("b.lab", "10.10.0.11", 9)].join("\n")),
    );
    expect(fqdnForIp("10.10.0.11", 5, a)).toBe("a.lab");
    expect(fqdnForIp("10.10.0.11", 100, a)).toBe("b.lab");
    expect(fqdnForIp("10.10.0.99", 5, a)).toBeNull();
  });
});
