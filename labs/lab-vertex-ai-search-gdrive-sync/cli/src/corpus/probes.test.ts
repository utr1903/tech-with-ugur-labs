import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FRESHNESS_PROBE, POSITIVE_PROBES } from "./probes.js";
import { loadSources } from "./sources.js";

const CORPUS_DIR = resolve(import.meta.dirname, "..", "..", "..", "corpus");

describe("the probe set", () => {
  it("has one probe per corpus document", async () => {
    const sources = await loadSources(CORPUS_DIR);

    expect(POSITIVE_PROBES.map((probe) => probe.docName).sort()).toEqual(
      sources.map((source) => source.name).sort(),
    );
  });

  it("asks for a fact that really is in that document", async () => {
    const sources = await loadSources(CORPUS_DIR);
    const bodyOf = new Map(sources.map((source) => [source.name, source.body]));

    for (const probe of POSITIVE_PROBES) {
      expect(bodyOf.get(probe.docName), probe.docName).toContain(probe.fact);
    }
  });

  it("asks for a fact that is in no other document", async () => {
    const sources = await loadSources(CORPUS_DIR);

    for (const probe of POSITIVE_PROBES) {
      const elsewhere = sources.filter(
        (source) => source.name !== probe.docName && source.body.includes(probe.fact),
      );
      expect(
        elsewhere.map((source) => source.name),
        probe.fact,
      ).toEqual([]);
    }
  });

  it("edits a document that is not in the folder the move test relocates", async () => {
    const sources = await loadSources(CORPUS_DIR);
    const target = sources.find((source) => source.name === FRESHNESS_PROBE.docName);

    expect(target?.folder).not.toBe("evaluation");
  });

  it("replaces a value that exists in that document with one that exists nowhere", async () => {
    const sources = await loadSources(CORPUS_DIR);

    const target = sources.find((source) => source.name === FRESHNESS_PROBE.docName);
    expect(target?.body).toContain(FRESHNESS_PROBE.original);
    for (const source of sources) {
      expect(source.body, source.name).not.toContain(FRESHNESS_PROBE.replacement);
    }
  });
});
