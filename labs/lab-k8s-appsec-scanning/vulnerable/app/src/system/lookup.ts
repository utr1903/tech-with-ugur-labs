import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// DELIBERATELY VULNERABLE: user input is concatenated into a shell command and
// run through /bin/sh, so any `;`-separated payload executes. A real diagnostic
// endpoint would use execFile with an argument array and validate the host.
export function buildLookupCommand(host: string): string {
  return `ping -c 1 -W 1 ${host}`;
}

export async function runLookup(host: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(buildLookupCommand(host));
    return `${stdout}${stderr}`;
  } catch (err) {
    // A failed ping (or an injected command that exits non-zero) still ran;
    // return whatever it produced so the attacker sees their output.
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}
