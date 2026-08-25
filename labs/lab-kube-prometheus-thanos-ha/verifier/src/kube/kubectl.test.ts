import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { type ExecFn, Kubectl } from "./kubectl.js";

const logger = pino({ level: "silent" });

function recordingExec(
  stdout = "",
  fail = false,
): { execFn: ExecFn; calls: string[][] } {
  const calls: string[][] = [];
  const execFn: ExecFn = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (fail) throw new Error("exec failed");
    return { stdout };
  };
  return { execFn, calls };
}

describe("Kubectl", () => {
  it("deletePod issues a non-blocking delete", async () => {
    const { execFn, calls } = recordingExec();
    await new Kubectl({ logger, execFn }).deletePod("ns1", "pod1");
    expect(calls[0]).toEqual([
      "kubectl",
      "delete",
      "pod",
      "pod1",
      "-n",
      "ns1",
      "--wait=false",
    ]);
  });

  it("isPodReady is true only when the Ready condition is True", async () => {
    const ready = new Kubectl({ logger, execFn: recordingExec("True").execFn });
    const notReady = new Kubectl({
      logger,
      execFn: recordingExec("False").execFn,
    });
    const gone = new Kubectl({
      logger,
      execFn: recordingExec("", true).execFn,
    });
    expect(await ready.isPodReady("ns", "p")).toBe(true);
    expect(await notReady.isPodReady("ns", "p")).toBe(false);
    expect(await gone.isPodReady("ns", "p")).toBe(false);
  });

  it("podNamesByLabel splits kubectl's name list", async () => {
    const { execFn } = recordingExec("pod-a pod-b");
    const names = await new Kubectl({ logger, execFn }).podNamesByLabel(
      "ns",
      "app=x",
    );
    expect(names).toEqual(["pod-a", "pod-b"]);
  });
});
