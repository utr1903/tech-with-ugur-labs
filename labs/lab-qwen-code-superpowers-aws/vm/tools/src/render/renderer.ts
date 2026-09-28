/**
 * Turns a stream of TranscriptEvents into the live terminal view. It
 * keeps the small bit of state a raw event stream doesn't carry (which
 * turn we're on, whether text is mid-stream, which tool a result
 * belongs to, the remembered outcome) and writes formatted lines as
 * events arrive. Both watch (live) and replay (from disk) drive the
 * same renderer. A class, rather than one big closure, keeps each
 * event's handling in its own short method; the streamed-delta and
 * round-result bookkeeping are their own small classes (`StreamState`,
 * `RoundResult`) so this dispatch switch can be read on its own — see
 * their own doc comments for what each one is responsible for.
 */
import type { RunInfo } from "../run/run-info.js";
import type { ContentBlock, TranscriptEvent } from "../transcript/events.js";
import {
  formatDriverFinishedLine,
  formatDriverReplyLine,
  formatFinishLines,
  formatInitLines,
  formatResumedLine,
  formatTurnLine,
} from "./renderer-format.js";
import { RoundResult } from "./round-result.js";
import { stripControlSequences } from "./sanitize.js";
import { StreamState } from "./stream-state.js";
import type { Style } from "./style.js";
import { formatToolResult, formatToolUse } from "./tools.js";

export interface RendererOptions {
  style: Style;
  maxTurns?: number;
  maxWallTime?: string;
  startedAtMs?: number;
  now?: () => number;
}

export interface Renderer {
  handle(event: TranscriptEvent): void;
  finish(info: RunInfo | null): void;
}

/** Prefixes every line with a dim "↳" when it came from a subagent. */
function subagentLines(
  lines: string[],
  subagent: boolean,
  style: Style,
): string[] {
  if (!subagent) return lines;
  return lines.map((l) => `${style.paint("dim", "  ↳")} ${l}`);
}

class RendererImpl implements Renderer {
  private turn = 0;
  private toolCalls = 0;
  private readonly toolNames = new Map<string, string>();
  private readonly stream = new StreamState();
  private readonly round = new RoundResult();
  private sawInit = false;

  constructor(
    private readonly write: (text: string) => void,
    private readonly options: RendererOptions,
  ) {}

  private get style(): Style {
    return this.options.style;
  }

  private closeStream(): void {
    this.stream.close(this.write);
  }

  private emit(lines: string[], subagent: boolean): void {
    for (const l of subagentLines(lines, subagent, this.style))
      this.write(`${l}\n`);
  }

  private handleBlock(block: ContentBlock, subagent: boolean): void {
    if (block.type === "tool_use") {
      this.toolCalls += 1;
      this.toolNames.set(block.id, block.name);
      this.emit(formatToolUse(block, this.style), subagent);
      return;
    }
    if (this.stream.sawPartials) return;
    if (block.type === "text")
      this.emit([`⏺ ${stripControlSequences(block.text)}`], subagent);
    else
      this.emit(
        [this.style.paint("dim", `✻ ${stripControlSequences(block.thinking)}`)],
        subagent,
      );
  }

  private handleDelta(kind: "text" | "thinking", text: string): void {
    this.stream.write(kind, text, this.write, this.style);
  }

  handle(event: TranscriptEvent): void {
    switch (event.kind) {
      case "init":
        this.closeStream();
        if (this.sawInit) {
          this.round.reset();
          this.write(formatResumedLine(this.style));
        } else {
          this.sawInit = true;
          this.write(formatInitLines(event, this.style));
        }
        return;
      case "notice":
        this.write(`${this.style.paint("yellow", `! ${event.subtype}`)}\n`);
        return;
      case "turn-start":
        this.closeStream();
        this.turn += 1;
        this.write(formatTurnLine(this.turn, this.options, this.style));
        return;
      case "text-delta":
        this.handleDelta("text", event.text);
        return;
      case "thinking-delta":
        this.handleDelta("thinking", event.text);
        return;
      case "block-end":
        this.closeStream();
        return;
      case "assistant":
        this.closeStream();
        for (const block of event.blocks)
          this.handleBlock(block, event.subagent);
        return;
      case "tool-result":
        this.emit(
          formatToolResult(
            this.toolNames.get(event.toolUseId),
            event,
            this.style,
          ),
          event.subagent,
        );
        return;
      case "result":
        this.round.record(event, this.turn, this.toolCalls, this.style);
        return;
      case "driver-reply":
        this.closeStream();
        this.round.reset();
        this.write(formatDriverReplyLine(event, this.style));
        return;
      case "driver-finished":
        this.closeStream();
        this.write(formatDriverFinishedLine(event, this.style));
        return;
      case "unknown":
        this.write(`${this.style.paint("dim", `· ${event.type} event`)}\n`);
        return;
      case "invalid":
        this.write(`${this.style.paint("dim", "· unreadable line")}\n`);
        return;
    }
  }

  finish(info: RunInfo | null): void {
    this.closeStream();
    this.write(
      formatFinishLines(
        info,
        this.round.resultLine,
        this.round.sawResult,
        this.style,
      ),
    );
  }
}

/** Creates a renderer that writes a coding-terminal view of a transcript to `write`. */
export function createRenderer(
  write: (text: string) => void,
  options: RendererOptions,
): Renderer {
  return new RendererImpl(write, options);
}
