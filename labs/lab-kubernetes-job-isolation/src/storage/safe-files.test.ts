import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readRegular } from "./safe-files.js";

it("reads only the allowed byte count and rejects an oversized regular file", async () => {
  const root = await mkdtemp(join(tmpdir(), "safe-read-"));
  try {
    const file = join(root, "result");
    await writeFile(file, "hello");
    expect((await readRegular(file, 5)).toString()).toBe("hello");
    await expect(readRegular(file, 4)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
