/**
 * CLI entrypoint: creates the shared logger and style, parses the
 * command and its flags (src/commands/args.ts), and dispatches to
 * watch, replay, or verify. Business logic lives in src/commands/*;
 * this file only wires it up.
 */
import { tmpdir } from "node:os";
import { parseCliArgs } from "./commands/args.js";
import { replayRun } from "./commands/replay.js";
import { verifyRun } from "./commands/verify.js";
import { watchRun } from "./commands/watch.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { createStyle } from "./render/style.js";
import { runStep } from "./verify/process.js";

const USAGE =
  "Usage: tools <watch|replay|verify> <runDir> [outFile] [--delay-ms N] [--acceptance dir]";

async function main(): Promise<void> {
  const logger = createLogger({ appName: "lab-tools" });
  installGlobalErrorHandlers(logger);

  const { command, runDir, outFile, delayMs, acceptanceDir } = parseCliArgs(
    process.argv.slice(2),
  );
  const style = createStyle(
    Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
  );
  const write = (text: string): void => {
    process.stdout.write(text);
  };

  if (command === "watch" && runDir) {
    await watchRun(runDir, { logger, write, style });
    return;
  }
  if (command === "replay" && runDir) {
    await replayRun(runDir, { logger, write, style, delayMs });
    return;
  }
  if (command === "verify" && runDir && outFile) {
    await verifyRun(
      {
        runDir,
        outFile,
        acceptanceDir,
        scratchDir: process.env.SCRATCH_DIR ?? tmpdir(),
      },
      { logger, write, style, runStep },
    );
    return;
  }
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

main();
