import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeExit, readRunInfo } from "./run-info.js";

const writeRunJson = async (data: unknown) => {
  const dir = await mkdtemp(join(tmpdir(), "run-info-"));
  await writeFile(join(dir, "run.json"), JSON.stringify(data));
  return dir;
};

const validRun = {
  runId: "run-1",
  task: "implement the feature",
  status: "finished",
  startedAt: "2026-09-28T10:00:00.000Z",
  finishedAt: "2026-09-28T10:05:00.000Z",
  exitCode: 0,
  durationSeconds: 300,
  maxTurns: 200,
  maxWallTime: "600s",
  model: "qwen3-coder-next",
};

describe("readRunInfo", () => {
  it("reads a fully populated run.json", async () => {
    const dir = await writeRunJson(validRun);
    expect(await readRunInfo(dir)).toEqual(validRun);
  });

  it("fills finishedAt, exitCode and durationSeconds with null when a run is still going", async () => {
    const dir = await writeRunJson({
      runId: "run-2",
      task: "implement the feature",
      status: "running",
      startedAt: "2026-09-28T10:00:00.000Z",
      maxTurns: 200,
      maxWallTime: "600s",
      model: "qwen3-coder-next",
    });
    const info = await readRunInfo(dir);
    expect(info.finishedAt).toBeNull();
    expect(info.exitCode).toBeNull();
    expect(info.durationSeconds).toBeNull();
  });

  it("throws an error naming a missing required field", async () => {
    const dir = await writeRunJson({
      task: "implement the feature",
      status: "running",
      startedAt: "2026-09-28T10:00:00.000Z",
      maxTurns: 200,
      maxWallTime: "600s",
      model: "qwen3-coder-next",
    });
    await expect(readRunInfo(dir)).rejects.toThrow("runId");
  });

  it("throws an error naming a field of the wrong type", async () => {
    const dir = await writeRunJson({ ...validRun, maxTurns: "200" });
    await expect(readRunInfo(dir)).rejects.toThrow("maxTurns");
  });
});

describe("describeExit", () => {
  it("describes a clean exit", () => {
    expect(describeExit(0)).toBe("exited 0");
  });

  it("describes the turn-limit exit", () => {
    expect(describeExit(53)).toContain("turn limit");
  });

  it("describes the wall-time or tool-call budget exit", () => {
    expect(describeExit(55)).toContain("wall-time or tool-call budget");
  });

  it("describes a killed process for common signal exit codes", () => {
    expect(describeExit(130)).toContain("killed");
    expect(describeExit(137)).toContain("killed");
    expect(describeExit(143)).toContain("killed");
  });

  it("describes a still-running process", () => {
    expect(describeExit(null)).toBe("still running");
  });

  it("describes any other exit code as a failure", () => {
    expect(describeExit(1)).toContain("failed");
  });
});
