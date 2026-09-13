import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, chown, lstat, mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  ExecutionError,
  type ExecutionResult,
  type ExecutionStore,
} from "../execution/types.js";
import { operation } from "../lib/operation.js";
import type { Logger } from "../logger.js";
import { readRegular } from "./safe-files.js";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type StoreOptions = {
  root: string;
  secure: boolean;
  logger: Logger;
  ownership?: typeof chown;
};

async function directory(path: string, mode: number): Promise<void> {
  await mkdir(path, { recursive: true, mode });
  if (!(await lstat(path)).isDirectory())
    throw new ExecutionError("infrastructure");
  await chmod(path, mode);
}
function metadata(bytes: Buffer): { exitCode: number; truncated: boolean } {
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  if (
    typeof value !== "object" ||
    value === null ||
    Object.keys(value).length !== 2 ||
    !("exitCode" in value) ||
    !("truncated" in value)
  )
    throw new ExecutionError("infrastructure");
  if (
    typeof value.exitCode !== "number" ||
    !Number.isInteger(value.exitCode) ||
    value.exitCode < 0 ||
    value.exitCode > 255 ||
    typeof value.truncated !== "boolean"
  )
    throw new ExecutionError("infrastructure");
  return { exitCode: value.exitCode, truncated: value.truncated };
}

export class FileExecutionStore implements ExecutionStore {
  private readonly known = new Set<string>();
  constructor(private readonly options: StoreOptions) {}
  async initialize(): Promise<void> {
    await operation(this.options.logger, "Initialize storage", {}, async () => {
      const { root } = this.options;
      await directory(root, 0o755);
      await directory(join(root, "private"), 0o700);
      await directory(join(root, "runs"), 0o755);
      const path = join(root, "private", "pii.json");
      const handle = await open(
        path,
        constants.O_CREAT |
          constants.O_WRONLY |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK,
        0o600,
      );
      try {
        if (!(await handle.stat()).isFile())
          throw new ExecutionError("infrastructure");
        await handle.chmod(0o600);
        await handle.truncate(0);
        await handle.writeFile(
          JSON.stringify({
            synthetic: true,
            canary: `FAKE-PII-${randomUUID()}`,
            name: "Synthetic Person",
            email: "synthetic.person@example.invalid",
          }),
        );
      } finally {
        await handle.close();
      }
    });
  }
  async prepare(id: string): Promise<void> {
    await operation(
      this.options.logger,
      "Prepare execution storage",
      { id },
      async () => {
        if (!uuid.test(id) || this.known.has(id))
          throw new ExecutionError("infrastructure");
        const path = join(this.options.root, "runs", id);
        await mkdir(path, { mode: 0o700 });
        try {
          if (this.options.secure)
            await (this.options.ownership ?? chown)(path, 10001, 10001);
        } catch (err) {
          await rm(path, { recursive: true, force: true });
          throw err;
        }
        this.known.add(id);
      },
    );
  }
  async read(id: string): Promise<ExecutionResult> {
    return operation(
      this.options.logger,
      "Read execution results",
      { id },
      async () => {
        this.assertKnown(id);
        const path = this.options.secure
          ? join(this.options.root, "runs", id)
          : this.options.root;
        const output = await readRegular(join(path, `${id}.md`), 65536);
        const exit = metadata(await readRegular(join(path, `${id}.exit`), 128));
        return {
          id,
          exitCode: exit.exitCode,
          output: output.toString("utf8"),
          ...(exit.truncated ? { truncated: true } : {}),
        };
      },
      (result) => ({
        exitCode: result.exitCode,
        truncated: result.truncated ?? false,
      }),
    );
  }
  async remove(id: string): Promise<void> {
    await operation(
      this.options.logger,
      "Remove execution storage",
      { id },
      async () => {
        this.assertKnown(id);
        if (!this.options.secure) {
          await rm(join(this.options.root, `${id}.md`), { force: true });
          await rm(join(this.options.root, `${id}.exit`), { force: true });
        }
        await rm(join(this.options.root, "runs", id), {
          recursive: true,
          force: true,
        });
        this.known.delete(id);
      },
    );
  }
  private assertKnown(id: string): void {
    if (!uuid.test(id) || !this.known.has(id))
      throw new ExecutionError("infrastructure");
  }
}
