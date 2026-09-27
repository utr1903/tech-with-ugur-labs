/**
 * Escapes the characters that have a meaning in a SQL LIKE pattern, so text
 * from the model is always matched literally and never as a wildcard.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
