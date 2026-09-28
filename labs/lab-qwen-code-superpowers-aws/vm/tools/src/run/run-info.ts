/**
 * Reads and validates the VM's run.json, the source of truth for a run's
 * status and budgets. Required fields are checked explicitly so a
 * malformed run.json fails loudly, naming the missing or wrong-typed
 * field, instead of producing an object with silent gaps the viewer or
 * verifier would misread.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface RunInfo {
  runId: string;
  task: string;
  status: "running" | "finished";
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  durationSeconds: number | null;
  maxTurns: number;
  maxWallTime: string;
  model: string;
  maxRounds: number | null;
}

type Json = Record<string, unknown>;

function requireString(raw: Json, name: string): string {
  const value = raw[name];
  if (typeof value !== "string")
    throw new Error(`run.json: missing or invalid field ${name}`);
  return value;
}

function requireNumber(raw: Json, name: string): number {
  const value = raw[name];
  if (typeof value !== "number")
    throw new Error(`run.json: missing or invalid field ${name}`);
  return value;
}

function requireStatus(raw: Json): "running" | "finished" {
  const value = raw.status;
  if (value !== "running" && value !== "finished") {
    throw new Error("run.json: missing or invalid field status");
  }
  return value;
}

function optionalString(raw: Json, name: string): string | null {
  const value = raw[name];
  return typeof value === "string" ? value : null;
}

function optionalNumber(raw: Json, name: string): number | null {
  const value = raw[name];
  return typeof value === "number" ? value : null;
}

/** Reads and validates `run.json` from a run directory. */
export async function readRunInfo(runDir: string): Promise<RunInfo> {
  const text = await readFile(join(runDir, "run.json"), "utf8");
  const raw = JSON.parse(text) as Json;
  return {
    runId: requireString(raw, "runId"),
    task: requireString(raw, "task"),
    status: requireStatus(raw),
    startedAt: requireString(raw, "startedAt"),
    finishedAt: optionalString(raw, "finishedAt"),
    exitCode: optionalNumber(raw, "exitCode"),
    durationSeconds: optionalNumber(raw, "durationSeconds"),
    maxTurns: requireNumber(raw, "maxTurns"),
    maxWallTime: requireString(raw, "maxWallTime"),
    model: requireString(raw, "model"),
    maxRounds: optionalNumber(raw, "maxRounds"),
  };
}

/** Turns an exit code into a one-line human description of why the run stopped. */
export function describeExit(exitCode: number | null): string {
  if (exitCode === null) return "still running";
  if (exitCode === 0) return "exited 0";
  if (exitCode === 53) return "stopped at the turn limit (exit 53)";
  if (exitCode === 55)
    return "stopped by the wall-time or tool-call budget (exit 55)";
  if (exitCode === 56) return "stopped at the round cap (exit 56)";
  if (exitCode === 130 || exitCode === 137 || exitCode === 143)
    return `killed (exit ${exitCode})`;
  return `failed (exit ${exitCode})`;
}
