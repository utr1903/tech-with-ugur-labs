/**
 * Removes leading and trailing whitespace from a model's final answer. At
 * least one Bedrock model wraps its answer in leading line breaks (for
 * example `"\n\n4"`), which would otherwise show up as blank lines before
 * the answer reaches the reader.
 */
export function trimAnswer(text: string): string {
  return text.trim();
}
