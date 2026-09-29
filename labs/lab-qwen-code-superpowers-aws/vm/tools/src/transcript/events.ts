/**
 * The normalized shape `parseLine` turns Qwen Code's stream-json lines into.
 * Both the live viewer and the verifier consume these events instead of
 * the raw wire format, so a change to Qwen Code's output only has to be
 * absorbed here. `driver-reply` and `driver-finished` are not Qwen
 * Code's own output: the resume driver running in the agent container
 * interleaves its own `type: "driver"` lines into the same transcript to
 * record the scripted owner replies it injects between rounds.
 */

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    };

export type TranscriptEvent =
  | {
      kind: "init";
      sessionId: string;
      model: string;
      cwd: string;
      tools: string[];
      version: string;
    }
  | { kind: "notice"; subtype: string }
  | { kind: "turn-start" }
  | { kind: "text-delta"; text: string }
  | { kind: "thinking-delta"; text: string }
  | { kind: "block-end" }
  | { kind: "assistant"; blocks: ContentBlock[]; subagent: boolean }
  | {
      kind: "tool-result";
      toolUseId: string;
      isError: boolean;
      content: string;
      subagent: boolean;
    }
  | {
      kind: "result";
      subtype: string;
      isError: boolean;
      durationMs: number;
      numTurns: number;
      text: string;
      errorMessage: string | null;
    }
  | { kind: "driver-reply"; round: number; stage: string; message: string }
  | {
      kind: "driver-finished";
      reason: string;
      rounds: number;
      exitCode: number;
    }
  | { kind: "unknown"; type: string }
  | { kind: "invalid" };
