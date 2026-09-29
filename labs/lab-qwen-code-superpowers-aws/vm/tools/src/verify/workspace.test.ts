import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareWorkspace } from "./workspace.js";

async function seedSource(dir: string): Promise<void> {
  await mkdir(join(dir, "src"), { recursive: true });
  await mkdir(join(dir, "node_modules/evil"), { recursive: true });
  await writeFile(join(dir, "src/a.ts"), "export const a = 1;\n");
  await writeFile(join(dir, "package.json"), "{}\n");
  await writeFile(
    join(dir, "node_modules/evil/index.js"),
    "module.exports = {};\n",
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("prepareWorkspace", () => {
  it("copies the project into scratch, excluding node_modules, leaving the source untouched", async () => {
    const source = await mkdtemp(join(tmpdir(), "verify-source-"));
    const scratch = await mkdtemp(join(tmpdir(), "verify-scratch-"));
    await seedSource(source);

    const target = await prepareWorkspace(source, scratch);

    expect(await exists(join(target, "src/a.ts"))).toBe(true);
    expect(await exists(join(target, "package.json"))).toBe(true);
    expect(await exists(join(target, "node_modules"))).toBe(false);
    expect(await exists(join(source, "node_modules/evil/index.js"))).toBe(true);
  });

  it("replaces a previous copy on a second call", async () => {
    const source = await mkdtemp(join(tmpdir(), "verify-source-"));
    const scratch = await mkdtemp(join(tmpdir(), "verify-scratch-"));
    await seedSource(source);
    const first = await prepareWorkspace(source, scratch);
    await writeFile(join(first, "stale.txt"), "leftover");
    await writeFile(join(source, "src/b.ts"), "export const b = 2;\n");

    const second = await prepareWorkspace(source, scratch);

    expect(second).toBe(first);
    expect(await exists(join(second, "stale.txt"))).toBe(false);
    expect(await exists(join(second, "src/b.ts"))).toBe(true);
  });
});
