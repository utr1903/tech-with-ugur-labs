/**
 * The classification rules `measured.ts` applies to a session's tool
 * calls: which files count as tests vs. source, which shell commands
 * count as running the tests or the program, and the yes/no/unknown
 * judgments derived from their relative order. Kept separate from the
 * transcript walk so each rule is a small, independently testable
 * pure function.
 */
import { basename } from "node:path";

export interface ToolCall {
  order: number;
  turn: number;
  id: string;
  name: string;
  input: Record<string, unknown>;
}

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SOURCE_FILE_RE = /\.[cm]?[jt]sx?$/;
const TEST_RUN_RE = /\b(npm\s+(run\s+)?test|npx\s+vitest|vitest(\s+run)?)\b/;

/** A test file: its basename matches test/spec, or it lives under a test(s) directory. */
function isTestFile(path: string): boolean {
  return (
    TEST_FILE_RE.test(basename(path)) ||
    path.includes("/test/") ||
    path.includes("/tests/")
  );
}

/** A source file: a JS/TS file that isn't a test, a type declaration, or a config file. */
function isSourceFile(path: string): boolean {
  const base = basename(path);
  if (isTestFile(path)) return false;
  if (base.endsWith(".d.ts")) return false;
  if (base.includes(".config.")) return false;
  return SOURCE_FILE_RE.test(base);
}

/** Finds which skills loaded successfully (unique, in order), which skill calls failed, and the first load's turn. */
export function analyzeSkills(
  calls: ToolCall[],
  results: Map<string, boolean>,
): {
  skillsLoaded: string[];
  skillCallsFailed: number;
  firstSkillTurn: number | null;
} {
  const skillsLoaded: string[] = [];
  let skillCallsFailed = 0;
  let firstSkillTurn: number | null = null;

  for (const call of calls) {
    if (call.name !== "skill" || typeof call.input.skill !== "string") continue;
    const isError = results.get(call.id);
    if (isError === undefined) continue;
    if (isError) {
      skillCallsFailed += 1;
      continue;
    }
    if (!skillsLoaded.includes(call.input.skill))
      skillsLoaded.push(call.input.skill);
    if (firstSkillTurn === null) firstSkillTurn = call.turn;
  }
  return { skillsLoaded, skillCallsFailed, firstSkillTurn };
}

/** Classifies a write_file/edit call's target path as a test write, a source write, or neither. */
function classifyFileWrite(call: ToolCall): "test" | "source" | null {
  if (call.name !== "write_file" && call.name !== "edit") return null;
  const path = call.input.file_path;
  if (typeof path !== "string") return null;
  if (isTestFile(path)) return "test";
  if (isSourceFile(path)) return "source";
  return null;
}

/** Finds the first test write, the first source write, and the last source write, by order. */
export function analyzeFiles(calls: ToolCall[]): {
  firstTestOrder: number | null;
  firstSourceOrder: number | null;
  lastSourceOrder: number | null;
} {
  let firstTestOrder: number | null = null;
  let firstSourceOrder: number | null = null;
  let lastSourceOrder: number | null = null;

  for (const call of calls) {
    const kind = classifyFileWrite(call);
    if (kind === "test") {
      if (firstTestOrder === null) firstTestOrder = call.order;
    } else if (kind === "source") {
      if (firstSourceOrder === null) firstSourceOrder = call.order;
      lastSourceOrder = call.order;
    }
  }
  return { firstTestOrder, firstSourceOrder, lastSourceOrder };
}

/** Finds whether the agent ran its tests and the program under test, and when it last did each. */
export function analyzeShell(
  calls: ToolCall[],
  programPattern: string | null,
): {
  ranTests: boolean;
  ranProgram: boolean | null;
  lastTestRunOrder: number | null;
  lastProgramRunOrder: number | null;
} {
  let ranTests = false;
  let lastTestRunOrder: number | null = null;
  let ranProgram: boolean | null = programPattern === null ? null : false;
  let lastProgramRunOrder: number | null = null;

  for (const call of calls) {
    if (call.name !== "run_shell_command") continue;
    const command = call.input.command;
    if (typeof command !== "string") continue;
    if (TEST_RUN_RE.test(command)) {
      ranTests = true;
      lastTestRunOrder = call.order;
    }
    if (programPattern !== null && command.includes(programPattern)) {
      ranProgram = true;
      lastProgramRunOrder = call.order;
    }
  }
  return { ranTests, ranProgram, lastTestRunOrder, lastProgramRunOrder };
}

/** "yes" iff the first test write came before the first source write; "unknown" without both. */
export function computeTestBeforeCode(
  firstTestOrder: number | null,
  firstSourceOrder: number | null,
): "yes" | "no" | "unknown" {
  if (firstTestOrder === null || firstSourceOrder === null) return "unknown";
  return firstTestOrder < firstSourceOrder ? "yes" : "no";
}

/** "yes" iff the last test run (and, with a program pattern, the last program run) came after the last source write. */
export function computeCheckedAfterLastChange(
  lastSourceOrder: number | null,
  lastTestRunOrder: number | null,
  programPattern: string | null,
  lastProgramRunOrder: number | null,
): "yes" | "no" | "unknown" {
  if (lastSourceOrder === null) return "unknown";
  const testedAfter =
    lastTestRunOrder !== null && lastTestRunOrder > lastSourceOrder;
  const programOk =
    programPattern === null ||
    (lastProgramRunOrder !== null && lastProgramRunOrder > lastSourceOrder);
  return testedAfter && programOk ? "yes" : "no";
}
