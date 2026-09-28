/**
 * Pure formatting helpers for the renderer: the init banner, the turn
 * separator (with an optional live elapsed clock), and the lines
 * printed once a run's outcome is known. Split out of renderer.ts so
 * the event-dispatch state machine can be read on its own.
 */
import type { RunInfo } from "../run/run-info.js";
import { describeExit } from "../run/run-info.js";
import type { Color, Style } from "./style.js";

/** Formats the two-line banner the viewer opens with once the init event arrives. */
export function formatInitLines(
  event: { version: string; model: string; cwd: string; tools: string[] },
  style: Style,
): string {
  const banner = style.paint(
    "bold",
    `Qwen Code ${event.version} · ${event.model} · ${event.cwd}`,
  );
  const toolCount = style.paint("dim", `${event.tools.length} tools available`);
  return `${banner}\n${toolCount}\n`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Formats milliseconds as a live-elapsed clock, "mm:ss". */
function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${pad2(Math.floor(totalSeconds / 60))}:${pad2(totalSeconds % 60)}`;
}

/** Formats milliseconds as a compact duration, "3m03s", for the finish summary. */
function formatCompactDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}m${pad2(totalSeconds % 60)}s`;
}

interface TurnOptions {
  maxTurns?: number;
  maxWallTime?: string;
  startedAtMs?: number;
  now?: () => number;
}

/** Formats the "── turn N/max · mm:ss / wall ──" separator written between turns. */
export function formatTurnLine(
  turn: number,
  options: TurnOptions,
  style: Style,
): string {
  const total = options.maxTurns ? `/${options.maxTurns}` : "";
  let elapsed = "";
  if (options.startedAtMs !== undefined && options.now !== undefined) {
    const clock = formatClock(options.now() - options.startedAtMs);
    elapsed = ` · ${clock}${options.maxWallTime ? ` / ${options.maxWallTime}` : ""}`;
  }
  return style.paint("dim", `\n── turn ${turn}${total}${elapsed} ──\n`);
}

interface ResultEvent {
  isError: boolean;
  numTurns: number;
  durationMs: number;
  errorMessage: string | null;
  subtype: string;
}

/** Formats the remembered result line: success in green, error in red. */
export function formatResultLine(
  event: ResultEvent,
  toolCalls: number,
  style: Style,
): string {
  if (!event.isError) {
    const duration = formatCompactDuration(event.durationMs);
    return style.paint(
      "green",
      `✔ Finished: ${event.numTurns} turns, ${toolCalls} tool calls, ${duration}`,
    );
  }
  return style.paint("red", `✘ ${event.errorMessage ?? event.subtype}`);
}

/** Colors the exit-code line: green for a clean exit, yellow for a budget stop, red otherwise. */
function exitColor(exitCode: number): Color {
  if (exitCode === 0) return "green";
  if (exitCode === 53 || exitCode === 55) return "yellow";
  return "red";
}

/** Formats the lines finish() writes once a run's outcome (if any) is known. */
export function formatFinishLines(
  info: RunInfo | null,
  resultLine: string | null,
  sawResult: boolean,
  style: Style,
): string {
  let out = "";
  if (sawResult && resultLine !== null) {
    out += `${resultLine}\n`;
  } else if (info?.status === "finished") {
    const message =
      "The transcript has no result line (the agent was stopped before it could write one).";
    out += `${style.paint("yellow", message)}\n`;
  }
  if (info && info.exitCode !== null) {
    out += `${style.paint(exitColor(info.exitCode), `Agent ${describeExit(info.exitCode)}`)}\n`;
  }
  return out;
}
