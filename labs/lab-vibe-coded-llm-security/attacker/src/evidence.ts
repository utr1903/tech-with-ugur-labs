import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export function appendEvidence(file: string, line: string): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${line}\n`);
}

export function readEvidence(file: string): string {
  if (!existsSync(file)) {
    return "";
  }
  return readFileSync(file, "utf8");
}
