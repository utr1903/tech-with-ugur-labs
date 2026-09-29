/**
 * Terminal colours through Node's built-in styleText. Disabled style
 * returns plain text, which keeps tests and piped output readable.
 */
import { styleText } from "node:util";

export type Color =
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "gray"
  | "bold"
  | "dim";

export interface Style {
  paint(color: Color | Color[], text: string): string;
}

/** Creates a Style; when disabled, paint() returns its input unchanged. */
export function createStyle(enabled: boolean): Style {
  return {
    paint: (color, text) =>
      enabled ? styleText(color, text, { validateStream: false }) : text,
  };
}
