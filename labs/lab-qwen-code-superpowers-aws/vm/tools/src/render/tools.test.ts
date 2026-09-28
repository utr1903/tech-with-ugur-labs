import { describe, expect, it } from "vitest";
import { createStyle } from "./style.js";
import { formatToolResult, formatToolUse } from "./tools.js";

const plain = createStyle(false);

describe("formatToolUse", () => {
  it("shows a new file as added lines with a relative path", () => {
    const lines = formatToolUse(
      {
        name: "write_file",
        input: { file_path: "/workspace/src/a.ts", content: "one\ntwo\n" },
      },
      plain,
    );
    expect(lines).toEqual(["● Write(src/a.ts)", "  + one", "  + two"]);
  });

  it("folds long files after 30 lines", () => {
    const content = Array.from({ length: 45 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    const lines = formatToolUse(
      {
        name: "write_file",
        input: { file_path: "/workspace/big.ts", content },
      },
      plain,
    );
    expect(lines).toHaveLength(32);
    expect(lines.at(-1)).toBe("  … 15 more lines");
  });

  it("shows an edit as a diff", () => {
    const lines = formatToolUse(
      {
        name: "edit",
        input: {
          file_path: "/workspace/src/a.ts",
          old_string: "  return 0;",
          new_string: "  return values.length;",
        },
      },
      plain,
    );
    expect(lines).toEqual([
      "● Edit(src/a.ts)",
      "  -   return 0;",
      "  +   return values.length;",
    ]);
  });

  it("shows a shell command on one line", () => {
    expect(
      formatToolUse(
        {
          name: "run_shell_command",
          input: { command: "npm test\n&& echo ok" },
        },
        plain,
      ),
    ).toEqual(["● Shell(npm test && echo ok)"]);
  });

  it("highlights skill loads", () => {
    expect(
      formatToolUse(
        { name: "skill", input: { skill: "superpowers:brainstorming" } },
        plain,
      ),
    ).toEqual(["★ Skill(superpowers:brainstorming)"]);
  });

  it("renders a todo list", () => {
    const todos = [
      { id: "1", content: "write tests", status: "completed" },
      { id: "2", content: "implement", status: "in_progress" },
      { id: "3", content: "run CLI", status: "pending" },
    ];
    expect(
      formatToolUse({ name: "todo_write", input: { todos } }, plain),
    ).toEqual(["● Todo", "  ☑ write tests", "  ◐ implement", "  ☐ run CLI"]);
  });

  it("falls back to the raw name and short arguments", () => {
    expect(
      formatToolUse(
        { name: "web_fetch", input: { url: "https://example.com" } },
        plain,
      ),
    ).toEqual(['● web_fetch({"url":"https://example.com"})']);
  });
});

describe("formatToolResult", () => {
  it("shows shell output, folded after 20 lines", () => {
    const content = Array.from({ length: 25 }, (_, i) => `out ${i}`).join("\n");
    const lines = formatToolResult(
      "run_shell_command",
      { isError: false, content },
      plain,
    );
    expect(lines[0]).toBe("  │ out 0");
    expect(lines).toHaveLength(21);
    expect(lines.at(-1)).toBe("  … 5 more lines");
  });

  it("shows errors", () => {
    expect(
      formatToolResult(
        "skill",
        { isError: true, content: 'Skill "brainstorming" not found.' },
        plain,
      ),
    ).toEqual(['  ✗ Skill "brainstorming" not found.']);
  });

  it("confirms a loaded skill", () => {
    expect(
      formatToolResult(
        "skill",
        { isError: false, content: "Use when…" },
        plain,
      ),
    ).toEqual(["  ⎿ skill loaded"]);
  });

  it("summarises other results in one line", () => {
    expect(
      formatToolResult(
        "glob",
        { isError: false, content: "Found 3 matching file(s)" },
        plain,
      ),
    ).toEqual(["  ⎿ Found 3 matching file(s)"]);
    expect(
      formatToolResult("read_file", { isError: false, content: "" }, plain),
    ).toEqual([]);
  });
});
