import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { ExecutionError } from "../execution/types.js";

export async function readRegular(
  path: string,
  maximum: number,
): Promise<Buffer> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > maximum)
      throw new ExecutionError("infrastructure");
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
  } finally {
    await handle.close();
  }
}
