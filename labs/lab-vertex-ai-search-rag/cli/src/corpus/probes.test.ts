import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "./documents.js";
import { ABSTENTION_QUESTION, CROSS_DOCUMENT_PROBE, POSITIVE_PROBES } from "./probes.js";

const CORPUS_DIR = resolve(import.meta.dirname, "..", "..", "..", "corpus");

describe("the probe set", () => {
  it("has one probe per corpus document", async () => {
    const docs = await loadCorpus(CORPUS_DIR);

    expect(POSITIVE_PROBES.map((p) => p.docId).sort()).toEqual(docs.map((d) => d.id).sort());
  });

  it("asks for a fact that really is in that document", async () => {
    const docs = await loadCorpus(CORPUS_DIR);
    const bodyOf = new Map(docs.map((d) => [d.id, d.body]));

    for (const probe of POSITIVE_PROBES) {
      expect(bodyOf.get(probe.docId), probe.docId).toContain(probe.fact);
    }
  });

  it("asks for a fact that is in no other document", async () => {
    const docs = await loadCorpus(CORPUS_DIR);

    for (const probe of POSITIVE_PROBES) {
      const elsewhere = docs.filter((d) => d.id !== probe.docId && d.body.includes(probe.fact));
      expect(
        elsewhere.map((d) => d.id),
        probe.fact,
      ).toEqual([]);
    }
  });

  it("asks the abstention question about something absent from the corpus", async () => {
    const docs = await loadCorpus(CORPUS_DIR);

    for (const doc of docs) {
      expect(doc.body.toLowerCase()).not.toContain("kubernetes");
    }
    expect(ABSTENTION_QUESTION.toLowerCase()).toContain("kubernetes");
  });

  it("spans exactly two documents in the cross-document probe", async () => {
    const docs = await loadCorpus(CORPUS_DIR);
    const bodyOf = new Map(docs.map((d) => [d.id, d.body]));

    expect(CROSS_DOCUMENT_PROBE.docIds).toHaveLength(2);
    expect(CROSS_DOCUMENT_PROBE.facts).toHaveLength(2);
    CROSS_DOCUMENT_PROBE.docIds.forEach((docId, index) => {
      expect(bodyOf.get(docId), docId).toContain(CROSS_DOCUMENT_PROBE.facts[index]);
    });
  });
});
