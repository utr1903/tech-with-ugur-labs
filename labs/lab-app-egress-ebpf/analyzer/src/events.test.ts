import { describe, expect, it } from "vitest";
import { argsByName, parseEvents } from "./events.js";

const execLine = JSON.stringify({
  timestamp: 1, eventName: "sched_process_exec", processId: 7,
  parentProcessId: 1, processName: "sys-helper", hostProcessId: 100,
  args: [{ name: "pathname", value: "/app/bin/sys-helper" },
         { name: "argv", value: ["sys-helper", "beacon"] }],
});
const logLine = JSON.stringify({ level: "error", msg: "enrich failed" });

describe("parseEvents", () => {
  it("parses event lines and skips internal log lines and blanks", () => {
    const events = parseEvents(`${execLine}\n${logLine}\n\n`);
    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe("sched_process_exec");
    expect(events[0].processId).toBe(7);
  });

  it("folds the args array into a name→value record", () => {
    const [e] = parseEvents(execLine);
    expect(argsByName(e).pathname).toBe("/app/bin/sys-helper");
    expect(argsByName(e).argv).toEqual(["sys-helper", "beacon"]);
  });
});
