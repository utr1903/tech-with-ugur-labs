import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { ExecutionError } from "../execution/types.js";

// Read attacker-writable result paths with bounded allocation and descriptor-based validation.
export async function readRegular(
  path: string,
  maximum: number,
): Promise<Buffer> {
  // Refuse symlinks and avoid blocking on FIFOs before checking the opened inode.
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    // Require a single-link regular file within the expected byte limit.
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > maximum)
      throw new ExecutionError("infrastructure");
    // Read one extra byte so growth during reading cannot silently bypass the limit.
    const buffer = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        size,
        buffer.length - size,
        size,
      );
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    // Recheck the descriptor and named path to detect replacement, relinking or size changes.
    const after = await handle.stat();
    const named = await lstat(path);
    if (
      size > maximum ||
      after.size !== size ||
      after.nlink !== 1 ||
      !named.isFile() ||
      named.ino !== after.ino ||
      named.dev !== after.dev
    )
      throw new ExecutionError("infrastructure");
    return buffer.subarray(0, size);
    // Always close the descriptor, including every validation failure.
  } finally {
    await handle.close();
  }
}
