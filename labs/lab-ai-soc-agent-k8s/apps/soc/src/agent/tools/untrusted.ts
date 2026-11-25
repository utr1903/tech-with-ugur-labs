/**
 * Marks tool output as data. Anything the model reads from logs, objects or
 * alerts may have been written by an attacker, so the system prompt tells it
 * to treat this block as evidence, never as instructions.
 *
 * Every "<" in the content becomes the JSON escape <. Matching only the
 * exact wrapper tag is bypassable (case, whitespace inside the tag), while
 * removing all "<" leaves nothing that can look like a tag. The escape is
 * lossless: callers pass JSON.stringify output, where "<" can only occur
 * inside string values, so JSON.parse of the content restores the original.
 */
export function wrapUntrusted(tool: string, content: string): string {
  const safe = content.replaceAll("<", "\\u003c");
  return `<untrusted_tool_output tool="${tool}">\n${safe}\n</untrusted_tool_output>`;
}
