// CLI wrapper: argument check, file read, JSON out, exit codes per the task.
import { readFile } from "node:fs/promises";
import { summarize } from "./summarize.js";

const args = process.argv.slice(2);
if (args.length !== 1) {
  process.stderr.write("usage: summarize <access-log>\n");
  process.exit(2);
}
try {
  const text = await readFile(args[0] as string, "utf8");
  process.stdout.write(`${JSON.stringify(summarize(text), null, 2)}\n`);
} catch (err) {
  process.stderr.write(`cannot read ${args[0]}: ${(err as Error).message}\n`);
  process.exit(1);
}
