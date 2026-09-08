/**
 * The logger owns machine-readable output on stdout; this is the one place the
 * CLI writes text meant for the person running it.
 */
export function writeLine(text: string): void {
  process.stdout.write(`${text}\n`);
}
