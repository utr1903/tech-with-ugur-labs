import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Allowlist: hostnames and IPv4/IPv6 literals only — no shell metacharacters.
const HOST_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,252})$/;

export function isValidHost(host: string): boolean {
  return HOST_RE.test(host);
}

export async function runLookup(host: string): Promise<string> {
  if (!isValidHost(host)) {
    return "invalid host";
  }
  try {
    // execFile with an argument array: `host` is a single argv element passed
    // to ping directly — never parsed by a shell.
    const { stdout, stderr } = await execFileAsync("ping", [
      "-c",
      "1",
      "-W",
      "1",
      host,
    ]);
    return `${stdout}${stderr}`;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}
