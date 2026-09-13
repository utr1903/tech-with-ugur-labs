import { spawn } from "node:child_process";
import { operation } from "../lib/operation.js";
import type { Logger } from "../logger.js";
import { root } from "./settings.js";
export type Runner = (command: string, args: string[]) => Promise<string>;
export function createRunner(logger: Logger): Runner {
  return (command, args) =>
    operation(
      logger,
      "Running setup command",
      { category: "command" },
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
            if (code === 0) resolve(output);
            else {
              logger.error(
                { category: "command", exitCode: code },
                "Running setup command failed.",
              );
              reject(new Error("Command failed."));
            }
          });
        }),
    );
}
