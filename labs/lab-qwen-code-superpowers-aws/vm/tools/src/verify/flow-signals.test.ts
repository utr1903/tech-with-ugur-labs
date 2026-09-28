import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "../transcript/events.js";
import { analyzeFlow } from "./flow-signals.js";
import type { ToolCall } from "./measured-signals.js";

const writeCall = (id: string, path: string): ToolCall => ({
  order: Number(id),
  turn: 1,
  id,
  name: "write_file",
  input: { file_path: path, content: "" },
});

const agentCall = (id: string): ToolCall => ({
  order: Number(id),
  turn: 1,
  id,
  name: "agent",
  input: { description: "d", prompt: "p" },
});

describe("analyzeFlow", () => {
  it("counts 1 round and no replies when the driver never appears", () => {
    const flow = analyzeFlow([], []);
    expect(flow).toEqual({
      rounds: 1,
      replies: {},
      specWritten: false,
      planWritten: false,
      subagentCalls: 0,
      finishReason: null,
    });
  });

  it("counts rounds as 1 plus the driver-reply events when there is no driver-finished event", () => {
    const events: TranscriptEvent[] = [
      { kind: "driver-reply", round: 2, stage: "spec", message: "m1" },
      { kind: "driver-reply", round: 3, stage: "plan", message: "m2" },
    ];
    const flow = analyzeFlow(events, []);
    expect(flow.rounds).toBe(3);
    expect(flow.replies).toEqual({ spec: 1, plan: 1 });
    expect(flow.finishReason).toBeNull();
  });

  it("prefers the driver-finished event's rounds and reason once it arrives", () => {
    const events: TranscriptEvent[] = [
      { kind: "driver-reply", round: 2, stage: "spec", message: "m1" },
      {
        kind: "driver-finished",
        reason: "round-cap",
        rounds: 8,
        exitCode: 56,
      },
    ];
    const flow = analyzeFlow(events, []);
    expect(flow.rounds).toBe(8);
    expect(flow.finishReason).toBe("round-cap");
  });

  it("detects a spec or plan write by path and counts agent tool calls", () => {
    const calls: ToolCall[] = [
      writeCall("1", "/workspace/docs/superpowers/specs/x.md"),
      writeCall("2", "/workspace/docs/superpowers/plans/x.md"),
      writeCall("3", "/workspace/src/a.ts"),
      agentCall("4"),
      agentCall("5"),
    ];
    const flow = analyzeFlow([], calls);
    expect(flow.specWritten).toBe(true);
    expect(flow.planWritten).toBe(true);
    expect(flow.subagentCalls).toBe(2);
  });

  it("counts a plan write made through edit as well as write_file", () => {
    const calls: ToolCall[] = [
      {
        order: 1,
        turn: 1,
        id: "1",
        name: "edit",
        input: {
          file_path: "/workspace/docs/superpowers/plans/x.md",
          old_string: "a",
          new_string: "b",
        },
      },
    ];
    const flow = analyzeFlow([], calls);
    expect(flow.planWritten).toBe(true);
    expect(flow.specWritten).toBe(false);
  });
});
