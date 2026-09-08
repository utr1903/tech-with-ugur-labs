import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSources } from "./sources.js";

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sources-"));
  await mkdir(join(dir, "retrieval"), { recursive: true });
  await mkdir(join(dir, "evaluation"), { recursive: true });
  await writeFile(join(dir, "retrieval", "beta.md"), "# Beta topic\n\nBeta body.\n");
  await writeFile(join(dir, "retrieval", "alpha.md"), "# Alpha topic\n\nAlpha body.\n");
  await writeFile(join(dir, "evaluation", "gamma.md"), "# Gamma topic\n\nGamma body.\n");
  await writeFile(join(dir, "retrieval", "notes.txt"), "not markdown");
  return dir;
}

describe("loadSources", () => {
  it("loads markdown from every subfolder, sorted by id", async () => {
    const sources = await loadSources(await fixtureDir());

    expect(sources.map((source) => source.id)).toEqual([
      "evaluation/gamma",
      "retrieval/alpha",
      "retrieval/beta",
    ]);
  });

  it("records the folder each document belongs in", async () => {
    const sources = await loadSources(await fixtureDir());

    expect(sources.find((source) => source.name === "gamma")?.folder).toBe("evaluation");
  });

  it("names the Google Doc after the file, without the extension", async () => {
    const sources = await loadSources(await fixtureDir());

    expect(sources.map((source) => source.name).sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("takes the title from the first heading", async () => {
    const sources = await loadSources(await fixtureDir());

    expect(sources.find((source) => source.name === "alpha")?.title).toBe("Alpha topic");
  });

  it("ignores files that are not markdown", async () => {
    const sources = await loadSources(await fixtureDir());

    expect(sources.some((source) => source.name === "notes")).toBe(false);
  });

  it("fails loudly when a document has no heading", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sources-"));
    await mkdir(join(dir, "retrieval"), { recursive: true });
    await writeFile(join(dir, "retrieval", "headless.md"), "no heading here\n");

    await expect(loadSources(dir)).rejects.toThrow(/headless\.md/);
  });
});
