/**
 * Formats one tool call and its result the way a coding terminal shows
 * them: a labeled action line, then a body shaped for that tool (a
 * diff, shell output, a todo list, or a short summary). Keeping each
 * tool's shape here means a new tool the agent starts using only needs
 * a case added in this one file, not a change to the renderer's
 * dispatch logic.
 */
import { formatEditDiff, splitContentLines } from "./diff-lines.js";
import type { Style } from "./style.js";

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const WORKSPACE_PREFIX = "/workspace/";
const relativePath = (path: string): string =>
  path.startsWith(WORKSPACE_PREFIX)
    ? path.slice(WORKSPACE_PREFIX.length)
    : path;

const cut = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

function actionLine(marker: string, label: string, arg?: string): string {
  return arg === undefined
    ? `${marker} ${label}`
    : `${marker} ${label}(${arg})`;
}

/** Shows at most `limit` lines, appending a dim "… N more lines" note for the rest. */
function withFold(style: Style, lines: string[], limit: number): string[] {
  if (lines.length <= limit) return lines;
  const hidden = lines.length - limit;
  return [
    ...lines.slice(0, limit),
    `  ${style.paint("dim", `… ${hidden} more lines`)}`,
  ];
}

function formatWriteBody(content: string, style: Style): string[] {
  const lines = splitContentLines(content).map(
    (l) => `  ${style.paint("green", "+")} ${l}`,
  );
  return withFold(style, lines, 30);
}

function formatShellLabel(command: string): string {
  return cut(command.replace(/\s+/g, " ").trim(), 120);
}

function isTodoItem(v: unknown): v is { content: string; status: string } {
  return (
    isRecord(v) && typeof v.content === "string" && typeof v.status === "string"
  );
}

function todoMarker(status: string): string {
  if (status === "completed") return "☑";
  if (status === "in_progress") return "◐";
  return "☐";
}

function formatTodoLines(todos: unknown): string[] {
  const items = Array.isArray(todos) ? todos : [];
  return items
    .filter(isTodoItem)
    .map((t) => `  ${todoMarker(t.status)} ${t.content}`);
}

const NAMED_TOOLS: Record<
  string,
  { label: string; argKey: string; isPath: boolean }
> = {
  read_file: { label: "Read", argKey: "file_path", isPath: true },
  glob: { label: "Glob", argKey: "pattern", isPath: false },
  grep_search: { label: "Grep", argKey: "pattern", isPath: false },
  list_directory: { label: "List", argKey: "path", isPath: true },
  agent: { label: "Agent", argKey: "description", isPath: false },
};

/** Formats an agent's tool call as the header (and body) line(s) a terminal view shows for it. */
export function formatToolUse(
  block: { name: string; input: Record<string, unknown> },
  style: Style,
): string[] {
  const cyan = style.paint("cyan", "●");
  const { input } = block;
  if (block.name === "write_file") {
    const path = relativePath(str(input.file_path));
    return [
      actionLine(cyan, "Write", path),
      ...formatWriteBody(str(input.content), style),
    ];
  }
  if (block.name === "edit") {
    const path = relativePath(str(input.file_path));
    const body = withFold(
      style,
      formatEditDiff(str(input.old_string), str(input.new_string), style),
      30,
    );
    return [actionLine(cyan, "Edit", path), ...body];
  }
  if (block.name === "run_shell_command") {
    return [actionLine(cyan, "Shell", formatShellLabel(str(input.command)))];
  }
  if (block.name === "skill") {
    return [
      actionLine(
        style.paint(["magenta", "bold"], "★"),
        "Skill",
        str(input.skill),
      ),
    ];
  }
  if (block.name === "todo_write") {
    return [actionLine(cyan, "Todo"), ...formatTodoLines(input.todos)];
  }
  const named = NAMED_TOOLS[block.name];
  if (named) {
    const arg = str(input[named.argKey]);
    return [
      actionLine(cyan, named.label, named.isPath ? relativePath(arg) : arg),
    ];
  }
  return [actionLine(cyan, block.name, cut(JSON.stringify(input), 80))];
}

/** Formats a tool result the way a terminal view shows it below the call. */
export function formatToolResult(
  toolName: string | undefined,
  result: { isError: boolean; content: string },
  style: Style,
): string[] {
  if (result.isError) {
    return result.content
      .split("\n")
      .slice(0, 5)
      .map((l, i) => style.paint("red", i === 0 ? `  ✗ ${l}` : `    ${l}`));
  }
  if (toolName === "run_shell_command") {
    const lines = result.content
      .split("\n")
      .map((l) => `  ${style.paint("dim", "│")} ${l}`);
    return withFold(style, lines, 20);
  }
  if (toolName === "skill") return ["  ⎿ skill loaded"];
  if (
    toolName === "write_file" ||
    toolName === "edit" ||
    toolName === "read_file"
  )
    return [];
  const first = result.content.split("\n")[0] ?? "";
  return first === "" ? [] : [`  ⎿ ${cut(first, 100)}`];
}
