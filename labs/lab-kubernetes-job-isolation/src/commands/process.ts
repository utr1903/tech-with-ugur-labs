import { spawn } from "node:child_process";
import { operation } from "../lib/operation.js";
import type { Logger } from "../logger.js";
import { root } from "./settings.js";
export type Runner = (command: string, args: string[]) => Promise<string>;
export function createRunner(logger: Logger): Runner {
  return (command, args) => {
    // Keep argv separate: these are literal spawn arguments, not a shell string.
    const fields: Record<string, unknown> = {
      category: "command",
      command,
      args,
      cwd: root,
    };
    return operation(
      logger,
      "Running setup command",
      fields,
      () =>
        new Promise((resolve, reject) => {
          const child = spawn(command, args, {
            cwd: root,
            shell: false,
            stdio: ["ignore", "pipe", "inherit"],
          });
          let output = "";
          child.stdout.on("data", (chunk) => {
            output += chunk;
          });
          child.on("error", reject);
          child.on("close", (code) => {
            fields.exitCode = code;
            if (code === 0) resolve(output);
            else {
              // Let the operation boundary emit one failure with the same argv.
              reject(new Error("Command failed."));
            }
          });
        }),
      (output) => ({ outputBytes: Buffer.byteLength(output) }),
    );
  };
}
