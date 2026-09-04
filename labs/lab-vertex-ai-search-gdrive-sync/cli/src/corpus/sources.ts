import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

export interface SourceDocument {
  /** `<folder>/<name>`, used only for logging and ordering. */
  id: string;
  folder: string;
  name: string;
  title: string;
  body: string;
}

function titleOf(body: string, fileName: string): string {
  const heading = body.split("\n").find((line) => line.startsWith("# "));
  if (heading === undefined) {
    throw new Error(`Corpus document ${fileName} has no "# " heading to use as its title.`);
  }
  return heading.slice(2).trim();
}

/** One subfolder per Drive folder; the file basename becomes the Google Doc's name. */
export async function loadSources(corpusDir: string): Promise<SourceDocument[]> {
  const folders = (await readdir(corpusDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const sources: SourceDocument[] = [];
  for (const folder of folders) {
    const fileNames = (await readdir(join(corpusDir, folder)))
      .filter((fileName) => fileName.endsWith(".md"))
      .sort();

    for (const fileName of fileNames) {
      const body = await readFile(join(corpusDir, folder, fileName), "utf8");
      const name = basename(fileName, ".md");
      sources.push({
        id: `${folder}/${name}`,
        folder,
        name,
        title: titleOf(body, fileName),
        body,
      });
    }
  }

  return sources;
}
