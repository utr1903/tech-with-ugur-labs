/**
 * Turns a stream of TranscriptEvents into the live terminal view. It
 * keeps the small bit of state a raw event stream doesn't carry (which
 * turn we're on, whether text is mid-stream, which tool a result
 * belongs to, the remembered outcome) and writes formatted lines as
 * events arrive. Both watch (live) and replay (from disk) drive the
 * same renderer. A class, rather than one big closure, keeps each
 * event's handling in its own short method.
 *
 * The remembered result is scoped to the current round: a driven
 * session's resume driver can restart the agent several times, each
 * restart marked by a `driver-reply` event and a repeated `init` event,
 * and each round has its own `result` line (or none, if that round was
 * cut short). Carrying an earlier round's result into a later round's
 * finish line would misreport the run's actual outcome, so both events
 * that start a new round clear it.
 */
import type { RunInfo } from "../run/run-info.js";
import type { ContentBlock, TranscriptEvent } from "../transcript/events.js";
import {
  formatDriverFinishedLine,
  formatDriverReplyLine,
  formatFinishLines,
  formatInitLines,
  formatResultLine,
  formatResumedLine,
  formatTurnLine,
} from "./renderer-format.js";
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

type StreamKind = "none" | "text" | "thinking";

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
  private streaming: StreamKind = "none";
  private sawPartials = false;
  private sawResult = false;
  private sawInit = false;
  private resultLine: string | null = null;

  constructor(
    private readonly write: (text: string) => void,
    private readonly options: RendererOptions,
  ) {}

  private get style(): Style {
    return this.options.style;
  }

  private closeStream(): void {
    if (this.streaming !== "none") {
      this.write("\n");
      this.streaming = "none";
    }
  }

  private emit(lines: string[], subagent: boolean): void {
    for (const l of subagentLines(lines, subagent, this.style))
      this.write(`${l}\n`);
  }

  /** Forgets the previous round's remembered result; called whenever a new round starts. */
  private resetRoundResult(): void {
    this.sawResult = false;
    this.resultLine = null;
  }

  private handleBlock(block: ContentBlock, subagent: boolean): void {
    if (block.type === "tool_use") {
      this.toolCalls += 1;
      this.toolNames.set(block.id, block.name);
      this.emit(formatToolUse(block, this.style), subagent);
      return;
    }
    if (this.sawPartials) return;
    if (block.type === "text") this.emit([`⏺ ${block.text}`], subagent);
    else this.emit([this.style.paint("dim", `✻ ${block.thinking}`)], subagent);
  }

  private handleDelta(kind: "text" | "thinking", text: string): void {
    this.sawPartials = true;
    if (this.streaming !== kind) {
      this.closeStream();
      this.write(kind === "text" ? "⏺ " : this.style.paint("dim", "✻ "));
      this.streaming = kind;
    }
    this.write(kind === "text" ? text : this.style.paint("dim", text));
  }

  handle(event: TranscriptEvent): void {
    switch (event.kind) {
      case "init":
        this.closeStream();
        if (this.sawInit) {
          this.resetRoundResult();
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
        this.sawResult = true;
        this.resultLine = formatResultLine(event, this.toolCalls, this.style);
        return;
      case "driver-reply":
        this.closeStream();
        this.resetRoundResult();
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
      formatFinishLines(info, this.resultLine, this.sawResult, this.style),
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
