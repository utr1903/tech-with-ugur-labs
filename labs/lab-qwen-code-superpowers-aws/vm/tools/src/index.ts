/**
 * CLI entrypoint: creates the shared logger and style, parses the
 * command and its flags, and dispatches to the watch or replay
 * command. Business logic lives in src/commands/*; this file only
 * wires it up.
 */
import { parseArgs } from "node:util";
import { replayRun } from "./commands/replay.js";
import { watchRun } from "./commands/watch.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { createStyle } from "./render/style.js";

const USAGE = "Usage: tools <watch|replay> <runDir> [--delay-ms N]";

async function main(): Promise<void> {
  const logger = createLogger({ appName: "lab-tools" });
  installGlobalErrorHandlers(logger);

  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { "delay-ms": { type: "string", default: "0" } },
  });
  const [command, runDir] = positionals;

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
    await replayRun(runDir, {
      logger,
      write,
      style,
      delayMs: Number(values["delay-ms"]),
    });
    return;
  }
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

main();
