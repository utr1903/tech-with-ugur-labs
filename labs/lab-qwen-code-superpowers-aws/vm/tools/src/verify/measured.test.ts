import { describe, expect, it } from "vitest";
import { readTranscript } from "../transcript/reader.js";
import { analyzeTranscript } from "./measured.js";

const fixture = (name: string) =>
  new URL(`../transcript/fixtures/${name}`, import.meta.url).pathname;

describe("analyzeTranscript", () => {
  it("measures a disciplined test-first session", async () => {
    expect(
      analyzeTranscript(
        await readTranscript(fixture("tdd-session.jsonl")),
        "summarize",
      ),
    ).toEqual({
      turns: 8,
      toolCalls: { edit: 1, run_shell_command: 3, skill: 1, write_file: 2 },
      skillsLoaded: ["superpowers:test-driven-development"],
      skillCallsFailed: 0,
      firstSkillTurn: 1,
      testBeforeCode: "yes",
      ranTests: true,
      ranProgram: true,
      checkedAfterLastChange: "yes",
      flow: {
        rounds: 1,
        replies: {},
        specWritten: false,
        planWritten: false,
        subagentCalls: 0,
        finishReason: null,
      },
    });
  });

  it("measures the driven-session fixture's scripted flow", async () => {
    const m = analyzeTranscript(
      await readTranscript(fixture("driven-session.jsonl")),
      null,
    );
    expect(m.flow).toEqual({
      rounds: 2,
      replies: { spec: 1 },
      specWritten: true,
      planWritten: false,
      subagentCalls: 1,
      finishReason: "complete",
    });
  });

  it("notices code written before its test and a run cut short", async () => {
    const m = analyzeTranscript(
      await readTranscript(fixture("budget-exit.jsonl")),
      "summarize",
    );
    expect(m.testBeforeCode).toBe("no");
    expect(m.ranTests).toBe(false);
    expect(m.ranProgram).toBe(false);
    expect(m.checkedAfterLastChange).toBe("no");
  });

  it("counts failed skill calls and leaves the program check open without a pattern", async () => {
    const m = analyzeTranscript(
      await readTranscript(fixture("edge-cases.jsonl")),
      null,
    );
    expect(m.skillsLoaded).toEqual([]);
    expect(m.skillCallsFailed).toBe(1);
    expect(m.ranProgram).toBeNull();
    expect(m.testBeforeCode).toBe("unknown");
    expect(m.checkedAfterLastChange).toBe("unknown");
  });

  it("does not count config files or type declarations as source", () => {
    const call = (id: string, path: string) => ({
      kind: "assistant" as const,
      subagent: false,
      blocks: [
        {
          type: "tool_use" as const,
          id,
          name: "write_file",
          input: { file_path: path, content: "" },
        },
      ],
    });
    const m = analyzeTranscript(
      [
        call("1", "/workspace/vitest.config.ts"),
        call("2", "/workspace/src/types.d.ts"),
        call("3", "/workspace/src/a.test.ts"),
        call("4", "/workspace/src/a.ts"),
      ],
      null,
    );
    expect(m.testBeforeCode).toBe("yes");
  });
});
