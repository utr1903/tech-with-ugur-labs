/**
 * Strips terminal control sequences out of agent-controlled text before
 * it is painted and written to the reader's terminal. Left alone, a
 * model could retitle the terminal, clear or rewrite the scrollback, or
 * write to the clipboard (OSC 52) just by putting the right escape
 * sequence in its own output — the viewer would faithfully reproduce it.
 * Callers apply this to the raw text before any of our own `styleText`
 * colouring, so the colour codes we add ourselves are never touched.
 */

// CSI: ESC [ ... final byte in @-~ — cursor moves, screen/line clears,
// colours, and similar.
// biome-ignore lint/suspicious/noControlCharactersInRegex: this is exactly what we're stripping.
const CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
// OSC: ESC ] ... terminated by BEL or ESC \ — window title, OSC 52
// clipboard writes, and similar.
// biome-ignore lint/suspicious/noControlCharactersInRegex: this is exactly what we're stripping.
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// Any other C0 control byte or DEL, except \n and \t, which the render
// already relies on for ordinary formatting.
// biome-ignore lint/suspicious/noControlCharactersInRegex: this is exactly what we're stripping.
const OTHER_CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;

/** Removes CSI/OSC escape sequences and other control bytes; newlines and tabs survive. */
export function stripControlSequences(text: string): string {
  return text.replace(CSI, "").replace(OSC, "").replace(OTHER_CONTROL, "");
}
