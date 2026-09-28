/**
 * Tracks the remembered result line across a driven run's rounds.
 *
 * Whether the run ended in success or error is scoped to the current
 * round: a driven session's resume driver can restart the agent several
 * times, each restart marked by a `driver-reply` event and a repeated
 * `init` event, and each round has its own `result` line (or none, if
 * that round was cut short). Carrying an earlier round's outcome into a
 * later round's finish line would misreport the run's actual outcome,
 * so both events that start a new round call `reset()`. The *counts*
 * `record()` folds in are not round-scoped, though: turns, tool calls
 * and elapsed time are whole-run totals, accumulated across every round
 * regardless of resets, because a multi-round run's finish line should
 * report what the whole run did, not just its last round.
 */
import { formatResultLine } from "./renderer-format.js";
import type { Style } from "./style.js";

interface ResultEventLike {
  isError: boolean;
  numTurns: number;
  durationMs: number;
  errorMessage: string | null;
  subtype: string;
}

export class RoundResult {
  private sawResultFlag = false;
  private line: string | null = null;
  private totalDurationMs = 0;
  private turnsFallbackSum = 0;

  get sawResult(): boolean {
    return this.sawResultFlag;
  }

  get resultLine(): string | null {
    return this.line;
  }

  /** Forgets the previous round's remembered result; called whenever a new round starts. */
  reset(): void {
    this.sawResultFlag = false;
    this.line = null;
  }

  /** Records one round's result line, folding its counts into the whole-run totals. */
  record(
    event: ResultEventLike,
    turnStarts: number,
    toolCalls: number,
    style: Style,
  ): void {
    this.sawResultFlag = true;
    this.totalDurationMs += event.durationMs;
    this.turnsFallbackSum += event.numTurns;
    this.line = formatResultLine(
      event,
      {
        turnStarts,
        turnsFallbackSum: this.turnsFallbackSum,
        toolCalls,
        totalDurationMs: this.totalDurationMs,
      },
      style,
    );
  }
}
