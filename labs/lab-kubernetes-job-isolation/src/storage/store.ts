import { chown, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  ExecutionError,
  type ExecutionResult,
  type ExecutionStore,
} from "../execution/types.js";
import { operation } from "../lib/operation.js";
import type { Logger } from "../logger.js";
import { initializeStorage } from "./initialize.js";
import { readRegular } from "./safe-files.js";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type StoreOptions = {
  root: string;
  secure: boolean;
  logger: Logger;
  ownership?: typeof chown;
};

// Treat worker-written metadata as untrusted and require the exact bounded result schema.
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

// Restrict collection and cleanup to server-generated IDs prepared during this lifespan.
export class FileExecutionStore implements ExecutionStore {
  private readonly known = new Set<string>();
  constructor(private readonly options: StoreOptions) {}
  // Create root-only synthetic private data before the server exposes execution.
  async initialize(): Promise<void> {
    await operation(
      this.options.logger,
      "Initialize storage",
      { root: this.options.root, secure: this.options.secure },
      async () => {
        await initializeStorage(this.options.root, this.options.logger);
      },
    );
  }
  // Create a fresh per-run directory; secure workers receive ownership of only that subPath.
  async prepare(id: string): Promise<void> {
    await operation(
      this.options.logger,
      "Prepare execution storage",
      { id, root: this.options.root, secure: this.options.secure },
      async () => {
        // Reject invalid/reused IDs before building filesystem paths or changing ownership.
        if (!uuid.test(id) || this.known.has(id))
          throw new ExecutionError("infrastructure");
        const path = join(this.options.root, "runs", id);
        await mkdir(path, { mode: 0o700 });
        try {
          if (this.options.secure)
            await (this.options.ownership ?? chown)(path, 10001, 10001);
        } catch (err) {
          // Roll back the new directory if ownership setup fails before registering it.
          await rm(path, { recursive: true, force: true });
          throw err;
        }
        this.known.add(id);
      },
    );
  }
  // Read the mode-specific files through the no-follow byte-limited reader before returning text.
  async read(id: string): Promise<ExecutionResult> {
    return operation(
      this.options.logger,
      "Read execution results",
      { id, root: this.options.root, secure: this.options.secure },
      async () => {
        this.assertKnown(id);
        const path = this.options.secure
          ? join(this.options.root, "runs", id)
          : this.options.root;
        const output = await this.readFile(id, join(path, `${id}.md`), 65536);
        const exit = await operation(
          this.options.logger,
          "Validate exit metadata",
          { id, maximumBytes: 128 },
          async () =>
            metadata(await this.readFile(id, join(path, `${id}.exit`), 128)),
          (exit) => ({ exitCode: exit.exitCode, truncated: exit.truncated }),
        );
        return {
          id,
          exitCode: exit.exitCode,
          output: output.toString("utf8"),
          ...(exit.truncated ? { truncated: true } : {}),
        };
      },
      (result) => ({
        exitCode: result.exitCode,
        outputBytes: Buffer.byteLength(result.output),
        truncated: result.truncated ?? false,
      }),
    );
  }
  // Remove only known output paths and the run directory; arbitrary extra whole-PVC files are untracked.
  async remove(id: string): Promise<void> {
    await operation(
      this.options.logger,
      "Remove execution storage",
      { id, root: this.options.root, secure: this.options.secure },
      async () => {
        this.assertKnown(id);
        if (!this.options.secure) {
          await rm(join(this.options.root, `${id}.md`), {
            recursive: true,
            force: true,
          });
          await rm(join(this.options.root, `${id}.exit`), {
            recursive: true,
            force: true,
          });
        }
        await rm(join(this.options.root, "runs", id), {
          recursive: true,
          force: true,
        });
        this.known.delete(id);
      },
    );
  }
  private readFile(
    id: string,
    path: string,
    maximumBytes: number,
  ): Promise<Buffer> {
    return operation(
      this.options.logger,
      "Read regular result file",
      { id, path, maximumBytes },
      () => readRegular(path, maximumBytes),
      (bytes) => ({ bytesRead: bytes.length }),
    );
  }
  // Prevent caller-selected traversal paths and cleanup of executions outside in-memory accounting.
  private assertKnown(id: string): void {
    if (!uuid.test(id) || !this.known.has(id))
      throw new ExecutionError("infrastructure");
  }
}
