import { describe, expect, it } from "vitest";
import { parseEvents } from "./events.js";
import { buildProcessTable, lineage } from "./processTable.js";

const events = parseEvents(
  [
    JSON.stringify({ eventName: "sched_process_exec", processId: 1, parentProcessId: 0, processName: "node", args: [{ name: "pathname", value: "/usr/local/bin/node" }, { name: "argv", value: ["node", "index.js"] }] }),
    JSON.stringify({ eventName: "sched_process_exec", processId: 7, parentProcessId: 1, processName: "sys-helper", args: [{ name: "pathname", value: "/app/bin/sys-helper" }, { name: "argv", value: ["sys-helper", "beacon"] }] }),
    JSON.stringify({ eventName: "security_socket_connect", processId: 9, parentProcessId: 7, processName: "sys-helper", args: [] }),
  ].join("\n"),
);

describe("buildProcessTable", () => {
  it("prefers exec data for path and argv", () => {
    const t = buildProcessTable(events);
    expect(t.get(7)?.path).toBe("/app/bin/sys-helper");
    expect(t.get(7)?.argv).toEqual(["sys-helper", "beacon"]);
    expect(t.get(7)?.ppid).toBe(1);
  });

  it("adds fallback entries for pids seen only on non-exec events", () => {
    const t = buildProcessTable(events);
    expect(t.get(9)?.comm).toBe("sys-helper");
    expect(t.get(9)?.path).toBe("");
  });
});

describe("lineage", () => {
  it("walks parents self-first up to pid 1", () => {
    const t = buildProcessTable(events);
    expect(lineage(7, t).map((p) => p.comm)).toEqual(["sys-helper", "node"]);
  });
});
