/**
 * Marks tool output as data. Anything the model reads from logs, objects or
 * alerts may have been written by an attacker, so the system prompt tells it
 * to treat this block as evidence, never as instructions. The wrapper tags
 * inside the content are escaped so the content cannot close the block early.
 */
export function wrapUntrusted(tool: string, content: string): string {
  const safe = content.replace(/<(\/?untrusted_tool_output)/g, "&lt;$1");
  return `<untrusted_tool_output tool="${tool}">\n${safe}\n</untrusted_tool_output>`;
}
