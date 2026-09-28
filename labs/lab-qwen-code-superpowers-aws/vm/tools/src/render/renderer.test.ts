import { describe, expect, it } from "vitest";
import type { RunInfo } from "../run/run-info.js";
import { readTranscript } from "../transcript/reader.js";
import { createRenderer } from "./renderer.js";
import { createStyle } from "./style.js";

const fixture = (name: string) =>
  new URL(`../transcript/fixtures/${name}`, import.meta.url).pathname;
const finishedRun = (exitCode: number): RunInfo => ({
  runId: "log-summary-20260928T100000Z",
  task: "log-summary",
  status: "finished",
  startedAt: "2026-09-28T10:00:00Z",
  finishedAt: "2026-09-28T10:03:03Z",
  exitCode,
  durationSeconds: 183,
  maxTurns: 150,
  maxWallTime: "45m",
  model: "qwen3-coder-next",
  maxRounds: null,
});

async function render(
  name: string,
  info: RunInfo | null,
  options: Record<string, unknown> = {},
): Promise<string> {
  let out = "";
  const renderer = createRenderer(
    (t) => {
      out += t;
    },
    { style: createStyle(false), maxTurns: 150, ...options },
  );
  for (const event of await readTranscript(fixture(name)))
    renderer.handle(event);
  renderer.finish(info);
  return out;
}

describe("renderer", () => {
  it("renders a session the way a coding terminal shows it", async () => {
    const out = await render("tdd-session.jsonl", finishedRun(0));
    expect(out).toContain("Qwen Code 0.24.6 · qwen3-coder-next · /workspace");
    expect(out).toContain("── turn 1/150 ──");
    expect(out).toContain("⏺ I'll start with the TDD skill.\n");
    expect(out).toContain("★ Skill(superpowers:test-driven-development)");
    expect(out).toContain("● Write(src/summarize.test.ts)");
    expect(out).toContain("  │ FAIL src/summarize.test.ts");
    expect(out).toContain("  +   return values.length;");
    expect(out).toContain("── turn 8/150 ──");
    expect(out).toContain("✔ Finished: 8 turns, 7 tool calls, 3m03s");
    expect(out).toContain("Agent exited 0");
  });

  it("prints streamed text once, not again from the complete message", async () => {
    const out = await render("tdd-session.jsonl", finishedRun(0));
    expect(out.split("All tests pass.").length - 1).toBe(1);
  });

  it("explains a run that ended without a result line", async () => {
    const out = await render("budget-exit.jsonl", finishedRun(53));
    expect(out).toContain("stopped at the turn limit (exit 53)");
    expect(out).toContain("The transcript has no result line");
  });

  it("shows elapsed time in live mode", async () => {
    const out = await render("tdd-session.jsonl", null, {
      startedAtMs: 0,
      now: () => 65_000,
      maxWallTime: "45m",
    });
    expect(out).toContain("── turn 1/150 · 01:05 / 45m ──");
  });

  it("keeps going through damaged and unknown lines", async () => {
    const out = await render("edge-cases.jsonl", finishedRun(1));
    expect(out).toContain("! retry");
    expect(out).toContain("· unreadable line");
    expect(out).toContain("· control_request event");
    expect(out).toContain('  ✗ Skill "brainstorming" not found.');
    expect(out).toContain("failed (exit 1)");
  });

  it("shows the scripted owner reply, a resumed session and the driver's finish line", async () => {
    const out = await render("driven-session.jsonl", finishedRun(0));
    expect(out).toContain(
      "▶ owner (scripted, round 2, spec): I accept your recommended option for every open question. Write the spec now, then continue straight to the plan.",
    );
    expect(out).toContain("── session resumed ──");
    expect(out).toContain("driver: complete after 2 rounds");
    const bannerCount =
      out.split("Qwen Code 0.24.6 · qwen3-coder-next · /workspace").length - 1;
    expect(bannerCount).toBe(1);
  });

  it("remembers the last of several result lines", async () => {
    const out = await render("driven-session.jsonl", finishedRun(0));
    expect(out).toContain("✔ Finished: 3 turns, 2 tool calls, 2m00s");
    expect(out.split("✔ Finished:").length - 1).toBe(1);
  });

  it("does not carry an earlier round's result into a later round cut short by a budget stop", async () => {
    const out = await render(
      "driven-session-budget-cutoff.jsonl",
      finishedRun(55),
    );
    expect(out).not.toContain("✔ Finished:");
    expect(out).toContain("The transcript has no result line");
    expect(out).toContain(
      "stopped by the wall-time or tool-call budget (exit 55)",
    );
  });
});
