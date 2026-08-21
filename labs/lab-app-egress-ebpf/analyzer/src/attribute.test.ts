import { describe, expect, it } from "vitest";
import { attribute, tcpConnects } from "./attribute.js";
import { parseEvents } from "./events.js";

const lines = [
  JSON.stringify({ eventName: "sched_process_exec", processId: 1, parentProcessId: 0, processName: "node", timestamp: 1, args: [{ name: "pathname", value: "/usr/local/bin/node" }, { name: "argv", value: ["node"] }] }),
  JSON.stringify({ eventName: "sched_process_exec", processId: 7, parentProcessId: 1, processName: "sys-helper", timestamp: 2, args: [{ name: "pathname", value: "/app/bin/sys-helper" }, { name: "argv", value: ["sys-helper"] }] }),
  JSON.stringify({ eventName: "net_packet_dns", processId: 7, parentProcessId: 1, processName: "sys-helper", timestamp: 3, args: [{ name: "proto_dns", value: { QR: 1, questions: [{ name: "telemetry.adnexus.lab", type: "A" }], answers: [{ name: "telemetry.adnexus.lab", type: "A", IP: "10.10.0.12" }] } }] }),
  JSON.stringify({ eventName: "security_socket_connect", processId: 7, parentProcessId: 1, processName: "sys-helper", timestamp: 4, args: [{ name: "type", value: "SOCK_STREAM" }, { name: "remote_addr", value: { sa_family: "AF_INET", sin_addr: "10.10.0.12", sin_port: "443" } }] }),
  JSON.stringify({ eventName: "security_socket_connect", processId: 7, parentProcessId: 1, processName: "sys-helper", timestamp: 4, args: [{ name: "type", value: "SOCK_DGRAM" }, { name: "remote_addr", value: { sa_family: "AF_INET", sin_addr: "10.10.0.3", sin_port: "53" } }] }),
];
const events = parseEvents(lines.join("\n"));

describe("tcpConnects", () => {
  it("keeps AF_INET SOCK_STREAM connects and drops UDP", () => {
    const c = tcpConnects(events);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ ip: "10.10.0.12", port: 443, pid: 7 });
  });
});

describe("attribute", () => {
  it("joins connect→fqdn and attaches process + lineage", () => {
    const [a] = attribute(events);
    expect(a.fqdn).toBe("telemetry.adnexus.lab");
    expect(a.ips).toEqual(["10.10.0.12"]);
    expect(a.process?.path).toBe("/app/bin/sys-helper");
    expect(a.lineage.map((p) => p.comm)).toEqual(["sys-helper", "node"]);
  });
});
