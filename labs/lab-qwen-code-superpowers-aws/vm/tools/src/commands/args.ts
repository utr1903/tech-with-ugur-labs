/**
 * Parses the CLI's positional command/paths and flags out of argv, so
 * index.ts stays a thin dispatcher. Kept separate (and tested) so the
 * parsing rules for the delay and acceptance flags don't have to be
 * exercised by running the whole CLI.
 */
import { parseArgs } from "node:util";

export interface CliArgs {
  command: string | undefined;
  runDir: string | undefined;
  outFile: string | undefined;
  delayMs: number;
  acceptanceDir: string | null;
}

/** Parses argv (excluding node and the script path) into the CLI's command, positionals and flags. */
export function parseCliArgs(argv: string[]): CliArgs {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "delay-ms": { type: "string", default: "0" },
      acceptance: { type: "string" },
    },
  });
  const [command, runDir, outFile] = positionals;
  return {
    command,
    runDir,
    outFile,
    delayMs: Number(values["delay-ms"]),
    acceptanceDir: values.acceptance ?? null,
  };
}
