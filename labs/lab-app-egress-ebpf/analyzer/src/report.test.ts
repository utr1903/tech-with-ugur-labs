import { describe, expect, it } from "vitest";
import { parseEvents } from "./events.js";
import { buildReport } from "./report.js";

const lines = [
  JSON.stringify({ eventName: "sched_process_exec", processId: 1, parentProcessId: 0, processName: "node", timestamp: 1, args: [{ name: "pathname", value: "/usr/local/bin/node" }, { name: "argv", value: ["node"] }] }),
  JSON.stringify({ eventName: "sched_process_exec", processId: 7, parentProcessId: 1, processName: "sys-helper", timestamp: 2, args: [{ name: "pathname", value: "/app/bin/sys-helper" }, { name: "argv", value: ["sys-helper"] }] }),
  JSON.stringify({ eventName: "net_packet_dns", processId: 1, parentProcessId: 0, processName: "node", timestamp: 2, args: [{ name: "proto_dns", value: { QR: 1, questions: [{ name: "updates.goodvendor.lab", type: "A" }], answers: [{ name: "updates.goodvendor.lab", type: "A", IP: "10.10.0.10" }] } }] }),
  JSON.stringify({ eventName: "security_socket_connect", processId: 1, parentProcessId: 0, processName: "node", timestamp: 3, args: [{ name: "type", value: "SOCK_STREAM" }, { name: "remote_addr", value: { sa_family: "AF_INET", sin_addr: "10.10.0.10", sin_port: "443" } }] }),
  JSON.stringify({ eventName: "net_packet_dns", processId: 7, parentProcessId: 1, processName: "sys-helper", timestamp: 4, args: [{ name: "proto_dns", value: { QR: 1, questions: [{ name: "telemetry.adnexus.lab", type: "A" }], answers: [{ name: "telemetry.adnexus.lab", type: "A", IP: "10.10.0.12" }] } }] }),
  JSON.stringify({ eventName: "security_socket_connect", processId: 7, parentProcessId: 1, processName: "sys-helper", timestamp: 5, args: [{ name: "type", value: "SOCK_STREAM" }, { name: "remote_addr", value: { sa_family: "AF_INET", sin_addr: "10.10.0.12", sin_port: "443" } }] }),
];

describe("buildReport", () => {
  it("marks blocklisted FQDNs malicious with helper attribution, vendor clean", () => {
    const report = buildReport(parseEvents(lines.join("\n")), new Set(["telemetry.adnexus.lab"]));
    const bad = report.rows.find((r) => r.fqdn === "telemetry.adnexus.lab");
    const good = report.rows.find((r) => r.fqdn === "updates.goodvendor.lab");
    expect(bad?.verdict).toBe("malicious");
    expect(bad?.process?.path).toBe("/app/bin/sys-helper");
    expect(bad?.lineage.map((p) => p.comm)).toEqual(["sys-helper", "node"]);
    expect(good?.verdict).toBe("clean");
    expect(good?.process?.comm).toBe("node");
  });
});
