/**
 * Turns an edit's before/after strings into the +/- lines a diff-style
 * terminal view shows, using the `diff` package's line-level diff so
 * only the lines that actually changed are surfaced.
 */
import { diffLines } from "diff";
import type { Color, Style } from "./style.js";

/** Splits text into lines, dropping the one trailing empty line a final "\n" produces. */
export function splitContentLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Formats an edit's old/new strings as +/- diff lines; unchanged runs are omitted. */
export function formatEditDiff(
  oldString: string,
  newString: string,
  style: Style,
): string[] {
  const lines: string[] = [];
  for (const change of diffLines(oldString, newString)) {
    if (!(change.added || change.removed)) continue;
    const marker = change.added ? "+" : "-";
    const color: Color = change.added ? "green" : "red";
    for (const line of splitContentLines(change.value)) {
      lines.push(`  ${style.paint(color, marker)} ${line}`);
    }
  }
  return lines;
}
