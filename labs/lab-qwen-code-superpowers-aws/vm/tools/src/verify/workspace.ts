/**
 * Makes the verifier's own copy of the agent's project. Excluding
 * node_modules forces the install check to reinstall from the
 * lockfile rather than reuse whatever the agent happened to leave on
 * disk, and copying (instead of checking in place) keeps the run
 * directory untouched.
 */
import { cp, rm } from "node:fs/promises";
import { join, sep } from "node:path";

/** Copies sourceDir into <scratchDir>/work, excluding node_modules, replacing any previous copy. */
export async function prepareWorkspace(
  sourceDir: string,
  scratchDir: string,
): Promise<string> {
  const target = join(scratchDir, "work");
  await rm(target, { recursive: true, force: true });
  await cp(sourceDir, target, {
    recursive: true,
    filter: (src) => !src.split(sep).includes("node_modules"),
  });
  return target;
}
