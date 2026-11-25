import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createSerializer } from "../lib/serialize.js";

type AuditEntry = Record<string, unknown>;

export type AuditTrail = {
  append(entry: AuditEntry): Promise<void>;
  read(): Promise<AuditEntry[]>;
};

/**
 * Append-only JSONL audit trail. There is no update or delete: the file
 * is only ever opened for append, and appends are serialized so two
 * concurrent requests can never interleave inside one line.
 */
export function createAuditTrail(filePath: string): AuditTrail {
  const serialize = createSerializer();
  return {
    append: (entry) =>
      serialize(async () => {
        await mkdir(dirname(filePath), { recursive: true });
        const line = JSON.stringify({
          time: new Date().toISOString(),
          ...entry,
        });
        await appendFile(filePath, `${line}\n`, "utf8");
      }),
    read: () =>
      serialize(async () => {
        const text = await readFile(filePath, "utf8").catch((err: unknown) => {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
          throw err;
        });
        return text
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as AuditEntry);
      }),
  };
}
