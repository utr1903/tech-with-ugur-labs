import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLine } from "./parse.js";

const lines = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8").split(
    "\n",
  );
const parseAll = (name: string) =>
  lines(name)
    .map(parseLine)
    .filter((e) => e !== null);

describe("parseLine reads the init line and stream-event deltas", () => {
  it("reads the init line", () => {
    expect(parseAll("tdd-session.jsonl")[0]).toEqual({
      kind: "init",
      sessionId: "s1",
      model: "qwen3-coder-next",
      cwd: "/workspace",
      tools: ["edit", "read_file", "run_shell_command", "skill", "write_file"],
      version: "0.24.6",
    });
  });

  it("turns partial text into deltas and ignores block starts and tool argument deltas", () => {
    const kinds = parseAll("tdd-session.jsonl")
      .slice(1, 6)
      .map((e) => e.kind);
    expect(kinds).toEqual([
      "turn-start",
      "text-delta",
      "text-delta",
      "block-end",
      "assistant",
    ]);
  });
});

describe("parseLine reads tool calls, tool results and the final result", () => {
  it("reads tool calls and results", () => {
    const events = parseAll("tdd-session.jsonl");
    expect(events).toContainEqual({
      kind: "assistant",
      subagent: false,
      blocks: [
        {
          type: "tool_use",
          id: "call_1",
          name: "skill",
          input: { skill: "superpowers:test-driven-development" },
        },
      ],
    });
    expect(events).toContainEqual({
      kind: "tool-result",
      toolUseId: "call_3",
      isError: false,
      subagent: false,
      content:
        "FAIL src/summarize.test.ts\nError: Cannot find module './summarize.js'",
    });
  });

  it("reads the result line", () => {
    expect(parseAll("tdd-session.jsonl").at(-1)).toEqual({
      kind: "result",
      subtype: "success",
      isError: false,
      durationMs: 183000,
      numTurns: 8,
      text: "All tests pass.",
      errorMessage: null,
    });
  });
});

describe("parseLine survives malformed and subagent lines", () => {
  it("survives blank, invalid, unknown and subagent lines", () => {
    const events = lines("edge-cases.jsonl").map(parseLine);
    expect(events[1]).toBeNull();
    expect(events[2]).toEqual({ kind: "invalid" });
    expect(events[3]).toEqual({ kind: "notice", subtype: "retry" });
    expect(events[4]).toEqual({ kind: "unknown", type: "control_request" });
    expect(events[5]).toEqual({
      kind: "thinking-delta",
      text: "Let me think.",
    });
    expect(events[6]).toBeNull();
    expect(events[8]).toMatchObject({ kind: "tool-result", isError: true });
    expect(events[9]).toMatchObject({ kind: "assistant", subagent: true });
    expect(events[10]).toEqual({
      kind: "tool-result",
      toolUseId: "call_11",
      isError: false,
      content: "",
      subagent: true,
    });
  });
});

describe("parseLine reads an error result", () => {
  it("reads an error result", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      duration_ms: 600012,
      num_turns: 9,
      error: {
        message:
          "Run aborted: wall-clock budget of 600s exceeded (--max-wall-time).",
      },
    });
    expect(parseLine(line)).toEqual({
      kind: "result",
      subtype: "error_during_execution",
      isError: true,
      durationMs: 600012,
      numTurns: 9,
      text: "",
      errorMessage:
        "Run aborted: wall-clock budget of 600s exceeded (--max-wall-time).",
    });
  });
});
